import type { Event, NotificationKind } from '@prisma/client';
import { prisma } from '../prisma';
import { botConfigured, escapeHtml, sendMessage, type SendOutcome } from './telegramBot';

/**
 * Уведомления участникам: тексты, даты и журнал.
 *
 * Отправка — best effort: ни одна бизнес-операция не должна падать из-за
 * Telegram. Поэтому здесь ничего не бросается, а каждая попытка попадает в
 * таблицу notifications — это и защита от повторов, и единственное место, где
 * видно, до кого сообщение не дошло.
 */

const APP_URL = (process.env.APP_URL ?? 'https://fiveandfive.kz').replace(/\/+$/, '');

/**
 * Куда ведёт кнопка «Открыть приложение» под сообщением: на старт, если
 * уведомление про конкретный старт (Mini App откроет его по ?race=<slug>),
 * иначе — в приложение. Mini App живёт на /app: корень — это сайт.
 */
async function appUrlFor(eventId: number | null): Promise<string> {
  if (eventId === null) return `${APP_URL}/app`;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { slug: true } });
  return event?.slug ? `${APP_URL}/app?race=${encodeURIComponent(event.slug)}` : `${APP_URL}/app`;
}

/**
 * Казахстан целиком живёт в UTC+5 без перехода на летнее время, а отдельной
 * зоны Asia/Astana в базе tz нет — это давно алиас Asia/Almaty. Отображаем
 * через Intl, а фиксированное смещение нужно ровно в одном месте: чтобы найти
 * полночь календарного дня (см. startOfDayInTz).
 */
const TZ = 'Asia/Almaty';
const TZ_OFFSET = '+05:00';

const DAY_MS = 86_400_000;

const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: TZ,
});
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', timeZone: TZ });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TZ,
});

/** «23 мая» */
export function dayMonth(date: Date): string {
  return dayMonthFmt.format(date);
}

/** «09:00» по времени Астаны. */
export function timeOfDay(date: Date): string {
  return timeFmt.format(date);
}

/**
 * Финишное время из секунд: «28:45», а для забегов длиннее часа — «1:02:05».
 * В БД лежат секунды, участнику нужен привычный формат.
 */
export function formatFinishTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

/** «2027-05-23» — календарный день в зоне Астаны, а не в UTC. */
export function ymdInTz(date: Date): string {
  // en-CA даёт ISO-подобный порядок yyyy-mm-dd без ручной сборки из частей.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TZ,
  }).format(date);
}

/** Полночь календарного дня по Астане как момент времени. */
export function startOfDayInTz(date: Date): Date {
  return new Date(`${ymdInTz(date)}T00:00:00${TZ_OFFSET}`);
}

/** Тот же день ± n суток. Без DST в Казахстане арифметика в миллисекундах точна. */
export function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Выдача стартовых пакетов (решение пользователя 2026-10-18):
 *  - основная — за 2 и за 1 день до старта; время и место — поле старта
 *    в админке (packetPickupInfo), пока не задано — «[время и место уточняются]»;
 *  - в день старта — только для иногородних, за 2 часа до старта и до часа
 *    до старта (при старте в 9:00 — 7:00–8:00). Никаких проверок в форме:
 *    так просто пишем в текстах.
 */
export const PICKUP_TBD = '[время и место уточняются]';

/** Время и место основной выдачи — из админки или «уточняются». */
export function pickupPlace(event: { packetPickupInfo?: string | null }): string {
  return event.packetPickupInfo?.trim() || PICKUP_TBD;
}

/** «с 07:00 до 08:00» — выдача в день старта (для иногородних). */
export function raceDayPickupText(eventDate: Date): string {
  return `с ${timeOfDay(shiftDays(eventDate, -2 / 24))} до ${timeOfDay(shiftDays(eventDate, -1 / 24))}`;
}

/** Дни основной выдачи: старт минус 2 и минус 1 день. */
export function packetPickupDays(eventDate: Date): { first: Date; second: Date } {
  return { first: shiftDays(eventDate, -2), second: shiftDays(eventDate, -1) };
}

/**
 * «21 и 22 мая», а на границе месяцев — «31 июля и 1 августа»: месяц дважды
 * повторяется только когда он действительно разный.
 */
export function pickupDaysText(eventDate: Date): string {
  const { first, second } = packetPickupDays(eventDate);
  const sameMonth = monthFmt.format(first) === monthFmt.format(second);
  return sameMonth
    ? `${dayFmt.format(first)} и ${dayMonth(second)}`
    : `${dayMonth(first)} и ${dayMonth(second)}`;
}

/**
 * Строка про стартовый пакет. Основная выдача — за 2 и за 1 день до старта;
 * когда она уже прошла (день старта), остаётся только выдача для иногородних.
 */
function packetLine(event: Event, now: Date): string {
  const raceDay = `Иногородним — в день старта ${raceDayPickupText(event.date)}.`;
  const pickupOver = now.getTime() >= startOfDayInTz(event.date).getTime();
  return pickupOver
    ? `🎒 Основная выдача стартовых пакетов уже прошла. ${raceDay}`
    : `🎒 Стартовый пакет — ${pickupDaysText(event.date)}, ${escapeHtml(pickupPlace(event))}. ${raceDay} Возьмите документ, удостоверяющий личность.`;
}

/**
 * Дата, время, место и дистанция — общий блок для регистрации и напоминания.
 * distance — дистанция участника; без неё — все дистанции старта.
 */
function whenWhereLines(event: Event, distance?: string): string {
  return [
    `📅 ${dayMonth(event.date)}, ${timeOfDay(event.date)} по Астане`,
    `📍 ${escapeHtml(event.location)}`,
    `📏 ${escapeHtml(distance ?? event.distance)}`,
  ].join('\n');
}

// ---------- Тексты ----------

export function registrationText(event: Event, now: Date = new Date(), distance?: string): string {
  return [
    '🏃 <b>Вы в деле!</b>',
    '',
    `Регистрация на «${escapeHtml(event.title)}» принята.`,
    '',
    whenWhereLines(event, distance),
    '',
    packetLine(event, now),
    '',
    'Номер участника и детали — в приложении, кнопка ниже.',
  ].join('\n');
}

export function seasonPassText(events: Event[]): string {
  const list = [...events]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((e) => `📅 ${dayMonth(e.date)} — ${escapeHtml(e.title)}`)
    .join('\n');

  return [
    '🏃 <b>Абонемент 5&amp;5 оформлен</b>',
    '',
    `Вы записаны на все ${events.length} стартов сезона:`,
    '',
    list,
    '',
    'О каждом напомним заранее. Стартовые пакеты выдаём за 2 и за 1 день до старта, иногородним — ещё и в день старта, утром.',
  ].join('\n');
}

export function resultText(
  event: Event,
  result: { finishTime: string; place: number; finishersTotal: number },
): string {
  // «1 из 1» выглядит издевательски — когда финишёр один, показываем только место.
  const place =
    result.finishersTotal > 1
      ? `<b>${result.place} из ${result.finishersTotal}</b>`
      : `<b>${result.place}</b>`;

  return [
    '🏁 <b>Результат готов</b>',
    '',
    `«${escapeHtml(event.title)}», ${dayMonth(event.date)}`,
    '',
    `Время: <b>${escapeHtml(result.finishTime)}</b>`,
    `Место: ${place}`,
    '',
    'Подробнее — в приложении, кнопка ниже.',
  ].join('\n');
}

export function reminderText(event: Event, now: Date = new Date(), distance?: string): string {
  return [
    '⏰ <b>Старт через 3 дня</b>',
    '',
    `«${escapeHtml(event.title)}»`,
    '',
    whenWhereLines(event, distance),
    '',
    packetLine(event, now),
    '',
    'До встречи!',
  ].join('\n');
}

// ---------- Отправка и журнал ----------

/**
 * Включены ли уведомления. Явное значение NOTIFY_ENABLED решает всё; если его
 * нет — рассылка работает только в проде. Так локальная разработка по умолчанию
 * никому не пишет, а прод не требует новой переменной, чтобы фича заработала.
 */
export function notificationsEnabled(): boolean {
  const raw = process.env.NOTIFY_ENABLED;
  if (raw !== undefined) return raw === 'true' || raw === '1';
  return process.env.NODE_ENV === 'production';
}

type Logger = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };

export type DeliverInput = {
  userId: number;
  /** Строкой: telegram_id — BigInt, а chat_id в Bot API принимается как есть. */
  telegramId: bigint | null;
  eventId: number | null;
  kind: NotificationKind;
  text: string;
  log?: Logger;
};

export type DeliverStatus = 'SENT' | 'BLOCKED' | 'FAILED' | 'SKIPPED';

/**
 * Отправить и записать результат в журнал. Не бросает никогда: вызывается уже
 * после того, как бизнес-операция зафиксирована, и испортить её не имеет права.
 *
 * Возвращает статус — чтобы массовой рассылке не приходилось перечитывать
 * журнал ради исхода каждой отправки.
 */
export async function deliver(input: DeliverInput): Promise<DeliverStatus> {
  const { userId, telegramId, eventId, kind, text, log } = input;

  const record = async (status: DeliverStatus, error?: string) => {
    try {
      const data = { status, error: error ?? null };

      if (eventId === null) {
        // Уникальный ключ здесь не работает: в Postgres NULL не равен NULL,
        // поэтому upsert по (user, null, kind) всегда создавал бы новую строку.
        // Такие уведомления (абонемент) ищем явно.
        const existing = await prisma.notification.findFirst({
          where: { userId, kind, eventId: null },
          select: { id: true },
        });
        if (existing) {
          await prisma.notification.update({ where: { id: existing.id }, data });
        } else {
          await prisma.notification.create({
            data: { userId, eventId: null, kind, ...data },
          });
        }
        return;
      }

      await prisma.notification.upsert({
        where: { userId_eventId_kind: { userId, eventId, kind } },
        create: { userId, eventId, kind, ...data },
        update: data,
      });
    } catch (err) {
      // Журнал не должен ронять отправку: сообщение уже ушло.
      log?.warn(
        { userId, kind, err: err instanceof Error ? err.message : String(err) },
        'Не удалось записать уведомление в журнал',
      );
    }
  };

  if (!notificationsEnabled() || !botConfigured()) {
    await record('SKIPPED', 'Уведомления выключены');
    return 'SKIPPED';
  }
  if (telegramId === null) {
    await record('SKIPPED', 'У пользователя нет telegram_id');
    return 'SKIPPED';
  }

  let outcome: SendOutcome;
  try {
    outcome = await sendMessage(telegramId.toString(), text, {
      text: 'Открыть приложение',
      url: await appUrlFor(eventId),
    });
  } catch (err) {
    // sendMessage не бросает, но подстраховка дешевле разбора инцидента.
    outcome = {
      ok: false,
      blocked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (outcome.ok) {
    await record('SENT');
    log?.info({ userId, kind, eventId }, 'Уведомление отправлено');
    return 'SENT';
  }

  const status: DeliverStatus = outcome.blocked ? 'BLOCKED' : 'FAILED';
  await record(status, outcome.error);
  log?.warn(
    { userId, kind, eventId, blocked: outcome.blocked, error: outcome.error },
    'Уведомление не отправлено',
  );
  return status;
}
