import { createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { PromoError, quotePromo, type PromoQuote, type PromoTarget } from './promo';

/**
 * Защита от перебора промокодов (2026-11-09). Неверные попытки хранятся в базе,
 * поэтому перезапуск сервера счётчики не сбрасывает. Пределы — на аккаунт, на
 * адрес и общий на всех (против перебора с множества аккаунтов). Пока предел
 * выбран, отказ одинаков и для верного кода: узнать по ответу, угадан ли он,
 * нельзя. Подключён ко всем путям, где проверяется код: /promo/check, запись и
 * абонемент.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const USER_PER_HOUR = 10;
export const USER_PER_DAY = 30;
export const IP_PER_HOUR = 30;
export const GLOBAL_PER_HOUR = 300;

const LOCKED = 'Слишком много неверных промокодов. Попробуйте позже';
const NOT_FOUND = 'Такого промокода нет';

const hashIp = (ip: string) => createHash('sha256').update(ip).digest('hex');

type Who = { telegramId: number; ip: string };

async function locked({ telegramId, ip }: Who): Promise<boolean> {
  const now = Date.now();
  const hourAgo = new Date(now - HOUR);
  const tg = BigInt(telegramId);
  const [userHour, userDay, ipHour, all] = await Promise.all([
    prisma.promoFailure.count({ where: { telegramId: tg, createdAt: { gte: hourAgo } } }),
    prisma.promoFailure.count({ where: { telegramId: tg, createdAt: { gte: new Date(now - DAY) } } }),
    prisma.promoFailure.count({ where: { ipHash: hashIp(ip), createdAt: { gte: hourAgo } } }),
    prisma.promoFailure.count({ where: { createdAt: { gte: hourAgo } } }),
  ]);
  return userHour >= USER_PER_HOUR || userDay >= USER_PER_DAY || ipHour >= IP_PER_HOUR || all >= GLOBAL_PER_HOUR;
}

async function recordFailure({ telegramId, ip }: Who): Promise<void> {
  await prisma.promoFailure.create({ data: { telegramId: BigInt(telegramId), ipHash: hashIp(ip) } });
  // Старше суток счётчикам не нужно.
  await prisma.promoFailure.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * DAY) } } });
}

export async function quotePromoGuarded(
  input: { code: string; target: PromoTarget; base: number; userId: number | null; reuseFor?: { registrationId?: number; seasonPassId?: number } },
  who: Who,
): Promise<PromoQuote> {
  if (await locked(who)) throw new PromoError(LOCKED);
  try {
    return await quotePromo(prisma, input);
  } catch (err) {
    if (err instanceof PromoError && err.message === NOT_FOUND) await recordFailure(who);
    throw err;
  }
}
