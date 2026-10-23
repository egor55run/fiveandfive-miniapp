import type { Prisma, User } from '@prisma/client';
import { personLabel, writeAudit } from './audit';
import { recomputePlaces } from './rating';

/**
 * Объединение двойников (решение пользователя 2026-10-23): один человек
 * оказался двумя участниками — например, добавлен вручную и потом записался
 * через приложение. Всё переносится на одного (into), второй (from) удаляется.
 *
 * Если оба записаны на один старт, у обоих есть результат того же старта или
 * абонемент одного сезона — отказ: сначала админ отменяет лишнее, чтобы не
 * гадать, какую запись оставить. Пустые поля профиля into дополняются из from;
 * Telegram переходит к into, если у него своего нет.
 */

type Tx = Prisma.TransactionClient;

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const KEEP_FIELDS = ['lastName', 'email', 'phone', 'birthDate', 'age', 'gender', 'username'] as const;

export async function mergeUsers(
  tx: Tx,
  input: { intoUserId: number; fromUserId: number; adminTelegramId: number },
): Promise<Record<string, number>> {
  const { intoUserId, fromUserId } = input;
  if (intoUserId === fromUserId) throw new MergeError('Это один и тот же участник');
  const [into, from] = await Promise.all([
    tx.user.findUnique({ where: { id: intoUserId } }),
    tx.user.findUnique({ where: { id: fromUserId } }),
  ]);
  if (!into || !from) throw new MergeError('Участник не найден');
  if (into.telegramId && from.telegramId) {
    throw new MergeError('У обоих свой Telegram — это разные люди или два аккаунта; объединять нельзя');
  }

  // Конфликты: один старт, один результат, один сезон.
  const [regsA, regsB, resA, resB, passA, passB] = await Promise.all([
    tx.registration.findMany({ where: { userId: intoUserId }, include: { event: true } }),
    tx.registration.findMany({ where: { userId: fromUserId }, include: { event: true } }),
    tx.result.findMany({ where: { userId: intoUserId } }),
    tx.result.findMany({ where: { userId: fromUserId } }),
    tx.seasonPass.findMany({ where: { userId: intoUserId } }),
    tx.seasonPass.findMany({ where: { userId: fromUserId } }),
  ]);
  const both = regsB.filter((b) => regsA.some((a) => a.eventId === b.eventId));
  if (both.length > 0) {
    throw new MergeError(
      `Оба записаны на «${both.map((r) => r.event.title).join('», «')}» — сначала отмените одну из записей`,
    );
  }
  if (resB.some((b) => resA.some((a) => a.eventId === b.eventId))) throw new MergeError('У обоих есть результат одного старта — сначала снимите лишний');
  if (passB.some((b) => passA.some((a) => a.seasonId === b.seasonId))) throw new MergeError('У обоих есть абонемент одного сезона');
  const promoB = await tx.promoRedemption.findMany({ where: { userId: fromUserId, status: { not: 'RELEASED' } } });
  const promoA = await tx.promoRedemption.findMany({ where: { userId: intoUserId, status: { not: 'RELEASED' } } });
  if (promoB.some((b) => promoA.some((a) => a.promoCodeId === b.promoCodeId))) throw new MergeError('Оба использовали один промокод');

  // Уведомления: одно на (участник, старт, вид) — дубли второго не нужны.
  const notesA = await tx.notification.findMany({ where: { userId: intoUserId }, select: { eventId: true, kind: true } });
  for (const n of notesA) {
    await tx.notification.deleteMany({ where: { userId: fromUserId, eventId: n.eventId, kind: n.kind } });
  }

  const where = { userId: fromUserId };
  const data = { userId: intoUserId };
  const moved: Record<string, number> = {
    registrations: (await tx.registration.updateMany({ where, data })).count,
    results: (await tx.result.updateMany({ where, data })).count,
    seasonPasses: (await tx.seasonPass.updateMany({ where, data })).count,
    payments: (await tx.payment.updateMany({ where, data })).count,
    consents: (await tx.consent.updateMany({ where, data })).count,
    refunds: (await tx.refund.updateMany({ where, data })).count,
    promoRedemptions: (await tx.promoRedemption.updateMany({ where, data })).count,
    notifications: (await tx.notification.updateMany({ where, data })).count,
    emails: (await tx.emailNotification.updateMany({ where, data })).count,
    auditLog: (await tx.adminAuditLog.updateMany({ where, data })).count,
  };

  // Пустые поля профиля — из второго; Telegram — к оставшемуся.
  const patch: Partial<User> = {};
  for (const f of KEEP_FIELDS) {
    if ((into[f] === null || into[f] === undefined) && from[f] !== null && from[f] !== undefined) {
      (patch as Record<string, unknown>)[f] = from[f];
    }
  }
  const telegramId = !into.telegramId && from.telegramId ? from.telegramId : null;
  await tx.user.delete({ where: { id: fromUserId } });
  await tx.user.update({ where: { id: intoUserId }, data: { ...patch, ...(telegramId ? { telegramId } : {}) } });

  // Места — по полу оставшегося (мог дополниться).
  for (const r of resB) await recomputePlaces(tx, r.eventId);

  await tx.userMerge.create({
    data: {
      intoUserId,
      fromUserId,
      fromLabel: `${personLabel(from)}${from.telegramId ? ` (Telegram ${from.telegramId})` : ''}`,
      adminTelegramId: BigInt(input.adminTelegramId),
      moved,
    },
  });
  for (const r of regsB) {
    await writeAudit(tx, {
      adminTelegramId: input.adminTelegramId,
      action: 'user.merge',
      eventId: r.eventId,
      registrationId: r.id,
      userId: intoUserId,
      subject: personLabel({ ...into, ...patch }),
      changes: { merge: [personLabel(from), personLabel({ ...into, ...patch })] },
    });
  }
  return moved;
}
