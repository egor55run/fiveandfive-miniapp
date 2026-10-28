import { prisma } from '../prisma';
import { escapeHtml } from './telegramBot';

/**
 * /stats в боте — сводка для админов (2026-10-28): пользователи (всего,
 * новые за сегодня и за 7 дней), регистрации по каждому старту, абонементы,
 * оплаты с суммой и возвраты. Права проверяет вызывающий (telegramWebhook).
 */

/** Казахстан — UTC+5 круглый год: «сегодня» считаем с местной полуночи. */
const TZ_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

const dateFmt = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: '2-digit' });
const stampFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Almaty',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function money(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')} ₸`;
}

export async function statsText(now: Date = new Date()): Promise<string> {
  const startOfToday = new Date(Math.floor((now.getTime() + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS);
  const weekAgo = new Date(startOfToday.getTime() - 6 * DAY_MS);

  const [usersTotal, usersToday, usersWeek, events, regs, passes, paid, refunds] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.event.findMany({ orderBy: { date: 'asc' }, select: { id: true, title: true, date: true } }),
    prisma.registration.groupBy({
      by: ['eventId', 'paymentStatus', 'seasonPassId'],
      where: { paymentStatus: { in: ['PAID', 'PENDING'] } },
      _count: { _all: true },
    }),
    prisma.seasonPass.groupBy({ by: ['paymentStatus'], _count: { _all: true } }),
    prisma.payment.aggregate({ where: { state: 'PAID' }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.refund.findMany({ select: { amount: true, confirmedAt: true } }),
  ]);

  const byEvent = new Map<number, { paid: number; viaPass: number; pending: number }>();
  for (const r of regs) {
    const row = byEvent.get(r.eventId) ?? { paid: 0, viaPass: 0, pending: 0 };
    if (r.paymentStatus === 'PAID') {
      row.paid += r._count._all;
      if (r.seasonPassId !== null) row.viaPass += r._count._all;
    } else {
      row.pending += r._count._all;
    }
    byEvent.set(r.eventId, row);
  }
  const passCount = (s: 'PAID' | 'PENDING' | 'CANCELLED') => passes.find((p) => p.paymentStatus === s)?._count._all ?? 0;
  const refundSum = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const refundWaiting = refunds.filter((r) => r.confirmedAt === null).length;

  const lines = [
    `📊 <b>Статистика 5&amp;5</b> — ${stampFmt.format(now).replace(',', '')}`,
    '',
    `👥 <b>Пользователи:</b> ${usersTotal}`,
    `сегодня +${usersToday}, за 7 дней +${usersWeek}`,
    '',
    '🏃 <b>Регистрации</b> (оплачено, в т. ч. по абонементу · ждут оплаты):',
  ];
  for (const e of events) {
    const row = byEvent.get(e.id) ?? { paid: 0, viaPass: 0, pending: 0 };
    const pass = row.viaPass > 0 ? ` (абонемент ${row.viaPass})` : '';
    const pending = row.pending > 0 ? ` · ждут ${row.pending}` : '';
    lines.push(`• ${dateFmt.format(e.date)} ${escapeHtml(e.title)}: <b>${row.paid}</b>${pass}${pending}`);
  }
  lines.push(
    '',
    `🎟 <b>Абонементы:</b> оплачено ${passCount('PAID')}, ждут оплаты ${passCount('PENDING')}`,
    `💳 <b>Оплаты:</b> ${paid._count._all} на ${money(Number(paid._sum.amount ?? 0))}`,
    `↩️ <b>Возвраты:</b> ${refunds.length} на ${money(refundSum)}` +
      (refundWaiting > 0 ? `, ждут подтверждения ${refundWaiting}` : ''),
  );
  return lines.join('\n');
}
