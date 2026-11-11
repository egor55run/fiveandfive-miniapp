import type { User } from '@prisma/client';
import { deliverEmail } from './email';
import { refundEmail } from './emailTemplates';
import { deliver } from './notify';
import { escapeHtml } from './telegramBot';

/**
 * Сообщение участнику об оформленном возврате — в бот и на почту
 * (решение пользователя 2026-11-11). Отправляется после того, как возврат
 * записан в базу; ничего не бросает.
 *
 * Срок — п. 5.4 оферты: «в течение 10 рабочих дней… тем же способом, которым
 * была произведена оплата (Kaspi.kz)». В документации ApiPay срока зачисления
 * нет, поэтому опираемся на оферту.
 */
export const REFUND_WORKING_DAYS = 10;

export type RefundLine = { eventId: number; title: string; amount: number; percent: number; base: number };
export type RefundNotice = { kind: 'single' | 'pass'; wholePass: boolean; lines: RefundLine[] };

const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ')} ₸`;
const OFFER = 'по правилам оферты (п. 5.1)';

/** Текст без разметки: абзацы и (для нескольких стартов) список. */
export function refundParts(n: RefundNotice): { title: string; head: string; list: string[]; tail: string[] } {
  const total = n.lines.reduce((s, l) => s + l.amount, 0);
  const one = n.lines.length === 1 ? n.lines[0] : null;
  const priceWord = n.kind === 'pass' ? 'стоимости этапа в абонементе' : 'стартового взноса';
  const tail: string[] = [];
  let head: string;
  let list: string[] = [];

  if (total === 0) {
    head = one
      ? `Регистрация на «${one.title}» отменена. Возврат за этот старт ${OFFER} не производится.`
      : `Регистрация на старты абонемента отменена. Возврат за них ${OFFER} не производится.`;
    if (!one) list = n.lines.map((l) => `«${l.title}»`);
  } else {
    if (one) {
      head = `Возврат оформлен: ${money(one.amount)} за «${one.title}».`;
      if (one.percent < 100) head += ` Это ${one.percent}% ${priceWord} (${money(one.base)}) — ${OFFER}.`;
    } else {
      head = `Возврат оформлен: ${money(total)} за абонемент.`;
      list = n.lines.map((l) =>
        l.percent === 100
          ? `«${l.title}» — ${money(l.amount)}`
          : l.amount === 0
            ? `«${l.title}» — без возврата, ${OFFER}`
            : `«${l.title}» — ${money(l.amount)}: ${l.percent}% от ${money(l.base)}, ${OFFER}`,
      );
    }
    tail.push(`Деньги вернутся на карту Kaspi в течение ${REFUND_WORKING_DAYS} рабочих дней.`);
  }
  if (total > 0) tail.push(one ? 'Регистрация на старт отменена.' : 'Регистрация на эти старты отменена.');
  if (n.wholePass) tail.push('Абонемент отменён.');
  return { title: total > 0 ? 'Возврат оформлен' : 'Регистрация отменена', head, list, tail };
}

/** Сообщение в бот (HTML Telegram). */
export function refundTelegramText(n: RefundNotice): string {
  const p = refundParts(n);
  return [
    `↩️ ${escapeHtml(p.head)}`,
    ...(p.list.length ? ['', ...p.list.map((l) => `• ${escapeHtml(l)}`)] : []),
    ...(p.tail.length ? ['', ...p.tail.map(escapeHtml)] : []),
    '',
    'Вопросы — нажми «Задать вопрос» в меню бота.',
  ].join('\n');
}

export async function notifyRefund(user: User, n: RefundNotice, log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }): Promise<void> {
  if (n.lines.length === 0) return;
  // Ключ журнала — первый старт возврата: у одного старта возврат бывает один раз.
  const eventId = n.lines[0].eventId;
  await deliver({ userId: user.id, telegramId: user.telegramId, eventId, kind: 'REFUND', text: refundTelegramText(n), log });
  await deliverEmail({
    userId: user.id,
    eventId,
    kind: 'REFUND',
    to: user.email,
    toName: user.firstName,
    message: refundEmail({ firstName: user.firstName, parts: refundParts(n) }),
    log,
  });
}
