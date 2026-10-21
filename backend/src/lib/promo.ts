import type { Prisma, PromoCode } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Промокоды (решения пользователя 2026-10-21).
 *
 *  - Скидка в % или фиксированной суммой; общий лимит использований; срок
 *    действия; код старта — только на этот старт, код серии (eventId null) —
 *    на любой старт и на абонемент.
 *  - Один раз на человека (частичный уникальный индекс в базе).
 *  - Использование засчитывается сразу при выставлении счёта (HELD); счёт не
 *    оплатили — RELEASED и вернулось в лимит; оплатили — USED.
 *  - Скидка считается на сервере до счёта в Kaspi: в счёт уходит итог.
 *  - Итог 0 ₸ (код на 100%) — регистрация «оплачено» без счёта, номер и
 *    письмо как обычно.
 */

type Tx = Prisma.TransactionClient;

export type PromoTarget = { kind: 'race'; eventId: number } | { kind: 'pass'; seasonId: number };

export type PromoQuote = { promo: PromoCode; base: number; discount: number; total: number };

export class PromoError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

export function discountOf(promo: Pick<PromoCode, 'kind' | 'value'>, base: number): number {
  const raw = promo.kind === 'PERCENT' ? Math.round((base * promo.value) / 100) : promo.value;
  return Math.max(0, Math.min(base, raw));
}

/** Сколько использований уже занято (выставленные счета + оплаченные). */
function usedCount(db: Tx | typeof prisma, promoCodeId: number): Promise<number> {
  return db.promoRedemption.count({ where: { promoCodeId, status: { in: ['HELD', 'USED'] } } });
}

/**
 * Проверить код для цели и посчитать скидку. reuseFor — то же использование
 * этим человеком для той же записи (повторное нажатие «Оплатить»): оно не
 * мешает и не считается вторым.
 */
export async function quotePromo(
  db: Tx | typeof prisma,
  input: { code: string; target: PromoTarget; base: number; userId: number | null; reuseFor?: { registrationId?: number; seasonPassId?: number } },
  now: Date = new Date(),
): Promise<PromoQuote> {
  const promo = await db.promoCode.findUnique({ where: { code: normalizeCode(input.code) } });
  if (!promo || !promo.active) throw new PromoError('Такого промокода нет');
  if (promo.validFrom && now < promo.validFrom) throw new PromoError('Промокод ещё не действует');
  if (promo.validUntil && now > promo.validUntil) throw new PromoError('Срок действия промокода закончился');
  if (promo.eventId !== null) {
    if (input.target.kind === 'pass') throw new PromoError('Этот промокод — для одного старта, на абонемент он не действует');
    if (promo.eventId !== input.target.eventId) throw new PromoError('Этот промокод — для другого старта');
  }
  if (input.userId !== null) {
    const mine = await db.promoRedemption.findFirst({
      where: { promoCodeId: promo.id, userId: input.userId, status: { in: ['HELD', 'USED'] } },
    });
    const same =
      mine &&
      mine.status === 'HELD' &&
      ((input.reuseFor?.registrationId && mine.registrationId === input.reuseFor.registrationId) ||
        (input.reuseFor?.seasonPassId && mine.seasonPassId === input.reuseFor.seasonPassId));
    if (mine && !same) throw new PromoError('Вы уже использовали этот промокод');
    if (!same && promo.maxUses !== null && (await usedCount(db, promo.id)) >= promo.maxUses) {
      throw new PromoError('Лимит использований промокода исчерпан');
    }
  } else if (promo.maxUses !== null && (await usedCount(db, promo.id)) >= promo.maxUses) {
    throw new PromoError('Лимит использований промокода исчерпан');
  }
  const discount = discountOf(promo, input.base);
  return { promo, base: input.base, discount, total: input.base - discount };
}

/**
 * Занять использование кода за записью — в транзакции, где занимается место.
 * Строка промокода блокируется (FOR UPDATE), лимит перепроверяется: двое не
 * возьмут последнее использование. Повтор для той же записи — то же
 * использование с новой суммой.
 */
export async function holdPromo(
  tx: Tx,
  input: {
    code: string;
    target: PromoTarget;
    base: number;
    userId: number;
    registrationId?: number;
    seasonPassId?: number;
    free: boolean;
  },
): Promise<PromoQuote & { redemptionId: number }> {
  await tx.$queryRaw`SELECT "id" FROM "promo_codes" WHERE "code" = ${normalizeCode(input.code)} FOR UPDATE`;
  const quote = await quotePromo(tx, {
    code: input.code,
    target: input.target,
    base: input.base,
    userId: input.userId,
    reuseFor: { registrationId: input.registrationId, seasonPassId: input.seasonPassId },
  });
  const status = quote.total === 0 ? 'USED' : 'HELD';
  const existing = await tx.promoRedemption.findFirst({
    where: {
      promoCodeId: quote.promo.id,
      userId: input.userId,
      status: 'HELD',
      ...(input.registrationId ? { registrationId: input.registrationId } : { seasonPassId: input.seasonPassId }),
    },
  });
  const data = { baseAmount: quote.base, discount: quote.discount, status } as const;
  const row = existing
    ? await tx.promoRedemption.update({ where: { id: existing.id }, data })
    : await tx.promoRedemption.create({
        data: {
          promoCodeId: quote.promo.id,
          userId: input.userId,
          registrationId: input.registrationId ?? null,
          seasonPassId: input.seasonPassId ?? null,
          ...data,
        },
      });
  return { ...quote, redemptionId: row.id };
}

type TargetWhere = { registrationId: number } | { seasonPassId: number };

/** Записался заново без кода — прежнее неоплаченное использование отпускаем. */
export async function releaseHeldFor(tx: Tx, where: TargetWhere): Promise<void> {
  await tx.promoRedemption.updateMany({ where: { ...where, status: 'HELD' }, data: { status: 'RELEASED' } });
}

/** Оплачено — использование окончательное. */
export async function markPromoUsed(tx: Tx, where: TargetWhere, paymentId: number): Promise<void> {
  await tx.promoRedemption.updateMany({ where: { ...where, status: 'HELD' }, data: { status: 'USED', paymentId } });
}

/** Привязать выставленный счёт к использованию (для истории в админке). */
export async function linkPromoPayment(tx: Tx | typeof prisma, redemptionId: number, paymentId: number): Promise<void> {
  await tx.promoRedemption.update({ where: { id: redemptionId }, data: { paymentId } });
}
