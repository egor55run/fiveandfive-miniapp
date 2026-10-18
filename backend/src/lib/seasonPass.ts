import type { Event, Season } from '@prisma/client';
import { prisma } from '../prisma';
import { registrationClosesAt } from './eligibility';

/**
 * Правила продажи абонемента (решение пользователя 2026-10-18):
 *  1. Только тем, у кого нет ни одной живой регистрации на отдельные старты
 *     сезона (оплаченной, ожидающей оплаты или добавленной вручную). Записи
 *     самого абонемента и отменённые — включая истёкшие неоплаченные — не
 *     мешают.
 *  2. Продажа закрывается вместе с регистрацией на первый старт сезона, если
 *     в админке не задана своя дата (Season.salesClosesAt).
 * Проверяет сервер (POST /season-passes) — приложение лишь заранее показывает
 * кнопку неактивной (GET /season-passes/eligibility).
 */

export type SeasonPassBlockReason = 'sales_closed' | 'has_registrations' | 'already_has_pass';

export const SEASON_PASS_MESSAGES: Record<SeasonPassBlockReason, string> = {
  sales_closed: 'Продажа абонемента закрыта',
  has_registrations: 'Абонемент доступен только до регистрации на отдельные старты',
  already_has_pass: 'У вас уже есть абонемент на этот сезон',
};

/** Когда закрывается продажа: задано в админке или как регистрация на 1-й старт. */
export function seasonSalesClosesAt(season: Season, events: Pick<Event, 'date' | 'registrationClosesAt'>[]): Date | null {
  if (season.salesClosesAt) return season.salesClosesAt;
  const first = [...events].sort((a, b) => a.date.getTime() - b.date.getTime())[0];
  return first ? registrationClosesAt(first) : null;
}

export function seasonSalesOpen(season: Season, events: Pick<Event, 'date' | 'registrationClosesAt'>[], now = new Date()): boolean {
  const closes = seasonSalesClosesAt(season, events);
  return closes === null || now.getTime() < closes.getTime();
}

/**
 * Можно ли этому человеку купить абонемент сейчас. null — можно, иначе причина.
 * telegramId — подтверждённый (из initData).
 */
export async function seasonPassBlock(
  season: Season,
  events: Pick<Event, 'id' | 'date' | 'registrationClosesAt'>[],
  telegramId: bigint,
): Promise<SeasonPassBlockReason | null> {
  if (!seasonSalesOpen(season, events)) return 'sales_closed';
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return null;
  const paidPass = await prisma.seasonPass.count({
    where: { userId: user.id, seasonId: season.id, paymentStatus: 'PAID' },
  });
  if (paidPass > 0) return 'already_has_pass';
  const single = await prisma.registration.count({
    where: {
      userId: user.id,
      eventId: { in: events.map((e) => e.id) },
      seasonPassId: null,
      paymentStatus: { in: ['PAID', 'PENDING'] },
    },
  });
  return single > 0 ? 'has_registrations' : null;
}
