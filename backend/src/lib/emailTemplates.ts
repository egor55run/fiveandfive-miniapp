import type { Event } from '@prisma/client';
import type { EmailMessage } from './email';
import { dayMonth, pickupDaysText, pickupPlace, raceDayPickupText, timeOfDay } from './notify';

/**
 * Письма участникам: регистрация (и оплата), абонемент, напоминание накануне.
 * Вёрстка — таблицами и инлайн-стилями (так письмо одинаково выглядит в Gmail,
 * Mail.ru, Яндексе и Outlook), цвета сайта. У каждого письма есть текстовая
 * версия — её показывают простые клиенты и по ней меньше шансов уйти в спам.
 */

const APP_URL = (process.env.APP_URL ?? 'https://fiveandfive.kz').replace(/\/+$/, '');
const TZ = 'Asia/Almaty';
/** Бот поддержки: staging — тестовый (BOT_USERNAME в .env), прод — боевой. */
const BOT = (process.env.BOT_USERNAME?.trim() || 'fiveandfive_run_bot').replace(/^@/, '');
const BOT_ASK_URL = `https://t.me/${BOT}?start=ask`;

const INK = '#15130F';
const PAPER = '#F2EEE7';
const ORANGE = '#FF6A13';
const ORANGE_TEXT = '#B03F08';
const MUTED = '#5E574D';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const weekdayDate = (d: Date) =>
  new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
    .format(d)
    .replace(/^./, (c) => c.toUpperCase());

const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n)} ₸`;

const raceUrl = (e: Event) => (e.slug ? `${APP_URL}/starty/${e.slug}` : APP_URL);

/** Строки «Старт / Место / Дистанция» — и для HTML, и для текста. */
function facts(e: Event, distance?: string | null): [string, string][] {
  return [
    ['Старт', `${weekdayDate(e.date)}, ${timeOfDay(e.date)} по Астане`],
    ['Место', e.location],
    ['Дистанция', distance ?? e.distance],
  ];
}

type Block = { kind: 'p'; html: string } | { kind: 'facts'; rows: [string, string][] } | { kind: 'list'; items: string[] };

/** Общая обёртка: шапка с логотипом, контент, кнопка, подвал. */
function layout(opts: {
  preheader: string;
  title: string;
  greeting: string;
  blocks: Block[];
  button?: { text: string; url: string };
}): string {
  const body = opts.blocks
    .map((b) => {
      if (b.kind === 'p') {
        return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK};">${b.html}</p>`;
      }
      if (b.kind === 'list') {
        return `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.55;color:${INK};">${b.items
          .map((i) => `<li style="margin:0 0 4px;">${i}</li>`)
          .join('')}</ul>`;
      }
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">${b.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 0;border-bottom:1px solid #E4DDD2;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${ORANGE_TEXT};width:120px;vertical-align:top;">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #E4DDD2;font-size:16px;font-weight:600;color:${INK};">${esc(v)}</td></tr>`,
        )
        .join('')}</table>`;
    })
    .join('');
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px;"><tr><td style="border-radius:999px;background:${ORANGE};"><a href="${esc(opts.button.url)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:${INK};text-decoration:none;border-radius:999px;">${esc(opts.button.text)}</a></td></tr></table>`
    : '';

  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;"><a href="${APP_URL}"><img src="${APP_URL}/brand/logo-h52.png" width="80" height="52" alt="5&amp;5 Run" style="display:block;border:0;"></a></td></tr>
<tr><td style="background:#FFFFFF;border-radius:20px;padding:28px 24px;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:${INK};">${esc(opts.title)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${INK};">${esc(opts.greeting)}</p>
${body}${button}
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.5;color:${MUTED};">
Вопросы — в Telegram-боте <a href="${BOT_ASK_URL}" style="color:${MUTED};">@${BOT}</a>.<br>
Вы получили это письмо, потому что зарегистрировались на забег серии 5&amp;5.<br>
ИП «5&amp;5» · Астана · <a href="${APP_URL}/privacy" style="color:${MUTED};">Политика обработки персональных данных</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Текстовая версия: те же факты, без вёрстки. */
function plain(lines: (string | null | false)[]): string {
  return [
    ...lines.filter((l): l is string => typeof l === 'string'),
    '',
    '—',
    `Вопросы — в Telegram-боте @${BOT}: ${BOT_ASK_URL}`,
    'Вы получили это письмо, потому что зарегистрировались на забег серии 5&5.',
    `ИП «5&5» · Астана · ${APP_URL}`,
  ].join('\n');
}

const hello = (firstName: string | null) => (firstName ? `Здравствуйте, ${firstName}!` : 'Здравствуйте!');

/** «11 и 12 июня — <где/когда>. Иногородним — в день старта с 07:00 до 08:00. Возьмите документ…» */
function pickupLine(e: Event): string {
  return `${pickupDaysText(e.date)} — ${pickupPlace(e)}. Иногородним — в день старта ${raceDayPickupText(e.date)}. Возьмите документ, удостоверяющий личность.`;
}

/** Регистрация на старт принята (и, если был счёт, — оплата получена). */
export function registrationEmail(p: {
  firstName: string | null;
  event: Event;
  distance?: string | null;
  paidAmount?: number | null;
}): EmailMessage {
  const paid = p.paidAmount && p.paidAmount > 0 ? `Оплата ${money(p.paidAmount)} получена — чек в Kaspi.kz.` : null;
  const rows = facts(p.event, p.distance);
  const subject = `Вы в деле: «${p.event.title}», ${dayMonth(p.event.date)}`;
  return {
    subject,
    html: layout({
      preheader: `Регистрация на «${p.event.title}» подтверждена`,
      title: 'Регистрация подтверждена',
      greeting: hello(p.firstName),
      blocks: [
        { kind: 'p', html: `Вы зарегистрированы на забег <b>«${esc(p.event.title)}»</b>.${paid ? ` ${esc(paid)}` : ''}` },
        { kind: 'facts', rows },
        { kind: 'p', html: `<b>Стартовый пакет.</b> ${esc(pickupLine(p.event))}` },
        {
          kind: 'p',
          html: 'Номер участника и все детали — в Telegram-приложении 5&amp;5. Туда же придёт напоминание накануне старта.',
        },
      ],
      button: { text: 'Страница старта', url: raceUrl(p.event) },
    }),
    text: plain([
      hello(p.firstName),
      '',
      `Вы зарегистрированы на забег «${p.event.title}».`,
      paid,
      '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      `Стартовый пакет. ${pickupLine(p.event)}`,
      '',
      'Номер участника и все детали — в Telegram-приложении 5&5. Туда же придёт напоминание накануне старта.',
      '',
      `Страница старта: ${raceUrl(p.event)}`,
    ]),
  };
}

/** Абонемент на сезон оформлен (и оплачен). */
export function seasonPassEmail(p: { firstName: string | null; events: Event[]; distance?: string | null; paidAmount?: number | null }): EmailMessage {
  const paid = p.paidAmount && p.paidAmount > 0 ? `Оплата ${money(p.paidAmount)} получена — чек в Kaspi.kz.` : null;
  const races = p.events.map((e) => `${dayMonth(e.date)}, ${timeOfDay(e.date)} — ${e.title}`);
  return {
    subject: `Абонемент 5&5: вы зарегистрированы на все ${p.events.length} стартов`,
    html: layout({
      preheader: 'Абонемент на сезон оформлен',
      title: 'Абонемент оформлен',
      greeting: hello(p.firstName),
      blocks: [
        {
          kind: 'p',
          html: `Вы зарегистрированы на все старты сезона${p.distance ? `, дистанция ${esc(p.distance)}` : ''}.${paid ? ` ${esc(paid)}` : ''}`,
        },
        { kind: 'list', items: races.map(esc) },
        {
          kind: 'p',
          html: 'Стартовые пакеты выдаём за 2 и за 1 день до каждого старта (время и место — на странице старта), иногородним — ещё и в день старта, утром. Перед каждым стартом пришлём напоминание.',
        },
      ],
      button: { text: 'Все старты', url: `${APP_URL}/#starty` },
    }),
    text: plain([
      hello(p.firstName),
      '',
      `Вы зарегистрированы на все старты сезона${p.distance ? `, дистанция ${p.distance}` : ''}.`,
      paid,
      '',
      ...races,
      '',
      'Стартовые пакеты выдаём за 2 и за 1 день до каждого старта (время и место — на странице старта), иногородним — ещё и в день старта, утром.',
      'Перед каждым стартом пришлём напоминание. Номер участника и детали — в Telegram-приложении 5&5.',
    ]),
  };
}

/** Время программы дня относительно старта (как на странице старта). */
const at = (e: Event, minutes: number) => timeOfDay(new Date(e.date.getTime() + minutes * 60_000));

/** Напоминание накануне старта. */
export function dayBeforeEmail(p: { firstName: string | null; event: Event; distance?: string | null }): EmailMessage {
  const e = p.event;
  const rows = facts(e, p.distance);
  const plan = [
    `${at(e, -120)}–${at(e, -60)} — выдача стартовых пакетов, только для иногородних`,
    `${at(e, -90)}–${at(e, -20)} — камера хранения`,
    `${at(e, -20)}–${at(e, -5)} — общая разминка`,
    `${at(e, 0)} — старт`,
    `${at(e, 60)} — закрытие финиша (контрольное время 1 час)`,
  ];
  const bring = [
    'документ, удостоверяющий личность — по нему выдаём стартовый пакет',
    'удобную беговую одежду и обувь по погоде',
    'участникам 16–17 лет — заполненное согласие родителя',
  ];
  return {
    subject: `Завтра старт: «${e.title}» в ${timeOfDay(e.date)}`,
    html: layout({
      preheader: `Завтра в ${timeOfDay(e.date)} — «${e.title}»`,
      title: 'Завтра старт!',
      greeting: hello(p.firstName),
      blocks: [
        { kind: 'p', html: `Напоминаем: завтра забег <b>«${esc(e.title)}»</b>.` },
        { kind: 'facts', rows },
        {
          kind: 'p',
          html: `<b>Стартовый пакет — сегодня</b>, последний день основной выдачи: ${esc(pickupPlace(e))}. Иногородним — завтра ${esc(raceDayPickupText(e.date))}.`,
        },
        { kind: 'p', html: '<b>Программа</b>' },
        { kind: 'list', items: plan.map(esc) },
        { kind: 'p', html: '<b>Что взять</b>' },
        { kind: 'list', items: bring.map(esc) },
        { kind: 'p', html: 'Не обязательно быть самым быстрым. Главное — продолжать. До встречи на старте!' },
      ],
      button: { text: 'Страница старта', url: raceUrl(e) },
    }),
    text: plain([
      hello(p.firstName),
      '',
      `Напоминаем: завтра забег «${e.title}».`,
      '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      `Стартовый пакет — сегодня, последний день основной выдачи: ${pickupPlace(e)}. Иногородним — завтра ${raceDayPickupText(e.date)}.`,
      '',
      'Программа:',
      ...plan.map((l) => `— ${l}`),
      '',
      'Что взять:',
      ...bring.map((l) => `— ${l}`),
      '',
      `Страница старта: ${raceUrl(e)}`,
    ]),
  };
}

/** То же напоминание — в Telegram (HTML бота). */
export function dayBeforeTelegram(e: Event, distance?: string | null): string {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '⏰ <b>Завтра старт!</b>',
    '',
    `«${escHtml(e.title)}»`,
    '',
    `📅 ${dayMonth(e.date)}, ${timeOfDay(e.date)} по Астане`,
    `📍 ${escHtml(e.location)}`,
    `📏 ${escHtml(distance ?? e.distance)}`,
    '',
    `🎒 Стартовый пакет — сегодня, последний день основной выдачи: ${escHtml(pickupPlace(e))}. Иногородним — завтра ${raceDayPickupText(e.date)}. Возьмите документ, удостоверяющий личность.`,
    '',
    'До встречи на старте!',
  ].join('\n');
}
