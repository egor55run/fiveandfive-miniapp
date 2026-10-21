import type { EventDto } from './api';

/**
 * Выдача стартовых пакетов для Mini App и сайта — те же правила, что в
 * текстах бота и писем (backend/src/lib/notify.ts): место и адрес из админки,
 * даты и часы — из дней выдачи; не задано — «уточняются» и запасное правило
 * «за 2 и за 1 день до старта». В день старта иногородним — за 2 часа до
 * старта и до часа до старта.
 */

const TZ = 'Asia/Almaty';
export const PICKUP_TBD = '[время и место уточняются]';

const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: TZ });
const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });

const DAY = 86_400_000;

/** Где: «место, адрес (комментарий)» или старое поле, или «уточняются». */
export function pickupWhere(e: EventDto): string {
  const where = [e.pickup?.place?.trim(), e.pickup?.address?.trim()].filter(Boolean).join(', ');
  const comment = (e.pickup?.comment ?? e.packetPickupInfo)?.trim();
  if (where) return comment ? `${where} (${comment})` : where;
  return comment || PICKUP_TBD;
}

/** Когда: «21 мая 12:00–20:00, 22 мая 10:00–18:00» или «21 и 22 мая». */
export function pickupWhen(e: EventDto): string {
  const slots = e.pickup?.slots ?? [];
  if (slots.length > 0) {
    return slots
      .map((s) => `${dayMonth.format(new Date(s.startsAt))} ${time.format(new Date(s.startsAt))}–${time.format(new Date(s.endsAt))}`)
      .join(', ');
  }
  const start = new Date(e.date).getTime();
  return `${dayMonth.format(new Date(start - 2 * DAY))} и ${dayMonth.format(new Date(start - DAY))}`;
}

/** Иногородним в день старта: «с 07:00 до 08:00». */
export function raceDayPickup(e: EventDto): string {
  const start = new Date(e.date).getTime();
  return `с ${time.format(new Date(start - 2 * 3_600_000))} до ${time.format(new Date(start - 3_600_000))}`;
}

/** Строки для блока «Выдача стартового пакета». */
export function pickupLines(e: EventDto): string[] {
  return [
    `${pickupWhen(e)} — ${pickupWhere(e)}.`,
    `Иногородним — в день старта ${raceDayPickup(e)}.`,
    'Возьмите документ, удостоверяющий личность.',
  ];
}
