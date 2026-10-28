import type { Prisma } from '@prisma/client';

/**
 * Журнал изменений из админки (admin_audit_log): кто, когда, что было → что
 * стало. Пишется в той же транзакции, что и само изменение: правки без записи
 * в журнале быть не должно.
 */

export type AuditAction =
  | 'participant.update'
  | 'participant.create'
  | 'registration.status'
  | 'registration.refund'
  | 'registration.bib'
  | 'result.update'
  | 'result.import'
  | 'result.publish'
  | 'user.merge'
  | 'season.update'
  | 'broadcast.send';

/** { поле: [было, стало] } — только то, что действительно изменилось. */
export type AuditChanges = Record<string, [string | null, string | null]>;

export function diffFields(
  before: Record<string, string | null>,
  after: Record<string, string | null>,
): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from !== to) changes[key] = [from, to];
  }
  return changes;
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    adminTelegramId: number;
    action: AuditAction;
    eventId?: number | null;
    registrationId?: number | null;
    userId?: number | null;
    subject: string;
    changes: AuditChanges;
  },
): Promise<void> {
  await tx.adminAuditLog.create({
    data: {
      adminTelegramId: BigInt(entry.adminTelegramId),
      action: entry.action,
      eventId: entry.eventId ?? null,
      registrationId: entry.registrationId ?? null,
      userId: entry.userId ?? null,
      subject: entry.subject,
      changes: entry.changes,
    },
  });
}

export const personLabel = (u: { lastName: string | null; firstName: string }) =>
  [u.lastName, u.firstName].filter(Boolean).join(' ');
