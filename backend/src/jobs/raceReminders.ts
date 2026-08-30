/**
 * Напоминания за 3 дня до старта — сама рассылка.
 *
 * Здесь только логика, без запуска: точка входа — jobs/runRaceReminders.ts.
 * Модуль, который что-то делает при импорте, нельзя ни протестировать, ни
 * переиспользовать, поэтому они разделены.
 *
 * Повторные запуски безопасны: уже отправленные напоминания отсеиваются по
 * журналу notifications, а неудачные попытки (сеть, 5xx) попробуются снова
 * на следующий день. 403 — «бот не может писать первым» — не повторяется:
 * такой участник помечен BLOCKED, и следующий прогон его пропустит.
 */
import { prisma } from '../prisma';
import {
  deliver,
  reminderText,
  shiftDays,
  startOfDayInTz,
  notificationsEnabled,
} from '../lib/notify';

/** За сколько дней до старта напоминаем. */
const DAYS_BEFORE = 3;

/** Печатаем в stdout: логи джобы читаются через pm2 logs, а не через pino. */
export const jobLog = {
  info: (obj: object, msg: string) => console.log(msg, JSON.stringify(obj)),
  warn: (obj: object, msg: string) => console.warn(msg, JSON.stringify(obj)),
};

export type ReminderStats = {
  /** Стартов в окне «через 3 дня». */
  events: number;
  sent: number;
  /** Уже уведомлены прошлым прогоном — их пропустили. */
  alreadyDone: number;
  /** Отправка выключена или у участника нет telegram_id. */
  skipped: number;
  /** Сеть, 5xx, таймаут — попробуем завтра. */
  failed: number;
  /** 403: бот не может написать первым. Повторять бесполезно. */
  blocked: number;
};

export async function sendRaceReminders(
  now: Date = new Date(),
  log = jobLog,
): Promise<ReminderStats> {
  // Ровно тот календарный день, что через 3 суток по Астане: от полуночи до
  // полуночи, независимо от времени старта внутри дня.
  const from = startOfDayInTz(shiftDays(now, DAYS_BEFORE));
  const to = shiftDays(from, 1);

  const events = await prisma.event.findMany({
    where: { date: { gte: from, lt: to } },
    include: {
      registrations: {
        // Отменённые регистрации не в счёт: человек на старт не идёт.
        where: { paymentStatus: { not: 'CANCELLED' } },
        include: { user: true },
      },
    },
    orderBy: { date: 'asc' },
  });

  const stats: ReminderStats = {
    events: events.length,
    sent: 0,
    alreadyDone: 0,
    skipped: 0,
    failed: 0,
    blocked: 0,
  };

  log.info(
    {
      from: from.toISOString(),
      to: to.toISOString(),
      events: events.length,
      enabled: notificationsEnabled(),
    },
    'Напоминания: окно',
  );

  for (const event of events) {
    // Кому уже отправляли — одним запросом на старт, а не по одному на участника.
    const already = await prisma.notification.findMany({
      where: {
        eventId: event.id,
        kind: 'RACE_REMINDER',
        // FAILED не в списке намеренно: такие попытки повторяем.
        status: { in: ['SENT', 'BLOCKED'] },
      },
      select: { userId: true },
    });
    const done = new Set(already.map((n) => n.userId));

    const text = reminderText(event, now);

    for (const registration of event.registrations) {
      if (done.has(registration.userId)) {
        stats.alreadyDone++;
        continue;
      }

      const status = await deliver({
        userId: registration.userId,
        telegramId: registration.user.telegramId,
        eventId: event.id,
        kind: 'RACE_REMINDER',
        text,
        log,
      });

      if (status === 'SENT') stats.sent++;
      else if (status === 'SKIPPED') stats.skipped++;
      else if (status === 'BLOCKED') stats.blocked++;
      else stats.failed++;
    }
  }

  return stats;
}
