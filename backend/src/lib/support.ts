import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../prisma';
import { DISTANCE_ORDER } from './distances';
import { registrationClosesAt } from './eligibility';
import { dayMonth, pickupDaysText, pickupPlace, raceDayPickupText, timeOfDay } from './notify';
import { registrationOpen } from './registrationWindow';
import { copyMessage, escapeHtml, sendMessage, type InlineButton } from './telegramBot';
import { adminTelegramIds } from './telegramLogin';

/**
 * Поддержка в боте (решение пользователя 2026-10-19, вместо ящика info@).
 *
 *  - «❓ Задать вопрос» — меню частых вопросов. Ответы — из content/faq.json
 *    (те же тексты, что на /voprosy), даты, места и выдача пакетов — из базы.
 *    Под ответом — «Помогло» / «Не помогло — написать нам».
 *  - «✍️ Другой вопрос» — человек пишет (текст, фото…), бот благодарит и
 *    пересылает всем админам вместе с карточкой: имя, @username, Telegram ID,
 *    регистрации и оплата.
 *  - «🤝 Стать партнёром» — анкета из 4 вопросов, итог — админам.
 *  - Админ отвечает реплаем на пересланное — бот отправляет ответ человеку.
 *    Дальше переписка продолжается: что человек пишет боту в течение
 *    THREAD_DAYS после вопроса, тоже уходит админам.
 */

const SITE = (process.env.APP_URL ?? 'https://fiveandfive.kz').replace(/\/+$/, '');
const THREAD_DAYS = 14;
/** Сколько сообщений от одного человека пересылаем за час — защита от спама. */
const MAX_PER_HOUR = 20;

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
export type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: unknown[];
  reply_to_message?: { message_id: number };
};

// ---------- Частые вопросы ----------

type FaqBlock = string | { list: string[] };
type FaqItem = { id: string; q: string; a: FaqBlock[] };

/** content/faq.json в корне репозитория — dist/lib и src/lib на одной глубине. */
function faqPath(): string {
  return process.env.FAQ_PATH?.trim() || path.resolve(__dirname, '../../../content/faq.json');
}

let faqCache: Map<string, FaqItem> | null = null;
function faq(id: string): FaqItem | null {
  if (!faqCache) {
    const data = JSON.parse(readFileSync(faqPath(), 'utf8')) as { ru: FaqItem[] };
    faqCache = new Map(data.ru.map((item) => [item.id, item]));
  }
  return faqCache.get(id) ?? null;
}

/** Абзац FAQ → HTML для Telegram: [текст](/адрес) — ссылка на сайт. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    const url = href.startsWith('/') ? `${SITE}${href}` : href;
    return `<a href="${url.replace(/"/g, '&quot;')}">${label}</a>`;
  });
}

function faqHtml(id: string): string {
  const item = faq(id);
  if (!item) return '';
  const body = item.a.map((b) => (typeof b === 'string' ? inline(b) : b.list.map((x) => `• ${inline(x)}`).join('\n')));
  return [`<b>${escapeHtml(item.q)}</b>`, ...body].join('\n\n');
}

// ---------- Ответы по темам ----------

const pricesPublic = () => process.env.PRICES_PUBLIC?.trim().toLowerCase() === 'true';
const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ')} ₸`;

function upcomingEvents() {
  return prisma.event.findMany({
    where: { date: { gt: new Date() } },
    orderBy: { date: 'asc' },
    include: { distances: { orderBy: DISTANCE_ORDER } },
  });
}

function registrationLine(): string {
  return registrationOpen()
    ? 'Регистрация открыта — записывайтесь в приложении.'
    : 'Регистрация скоро откроется. Чтобы узнать первым, нажмите в боте /start → «Сообщить об открытии регистрации».';
}

async function racesAnswer(): Promise<string> {
  const events = await upcomingEvents();
  if (events.length === 0) return '<b>Старты</b>\n\nРасписание нового сезона скоро появится.';
  const lines = events.map((e) => {
    const distances = e.distances.map((d) => d.label).join(', ') || e.distance;
    const page = e.slug ? ` · <a href="${SITE}/starty/${encodeURIComponent(e.slug)}">подробнее</a>` : '';
    return [
      `🏁 <b>${escapeHtml(e.title)}</b> — ${dayMonth(e.date)}, ${timeOfDay(e.date)}`,
      `📍 ${escapeHtml(e.location)} · ${escapeHtml(distances)}`,
      `Регистрация до ${dayMonth(registrationClosesAt(e))}${page}`,
    ].join('\n');
  });
  return ['<b>Старты сезона</b>', ...lines, registrationLine()].join('\n\n');
}

async function priceAnswer(): Promise<string> {
  let prices = 'Цена будет объявлена.';
  if (pricesPublic()) {
    const [event] = await upcomingEvents();
    const season = await prisma.season.findFirst({ where: { isActive: true } }).catch(() => null);
    const race = event?.distances[0] ? money(Math.round(Number(event.distances[0].price))) : null;
    const pass = season && Number(season.price) > 0 ? money(Math.round(Number(season.price))) : null;
    prices = [race && `Один старт — ${race}.`, pass && `Абонемент на сезон — ${pass}.`].filter(Boolean).join(' ') || prices;
  }
  return [faqHtml('register'), faqHtml('season-pass'), `💳 <b>Цена.</b> ${prices}`].join('\n\n');
}

async function packAnswer(): Promise<string> {
  const events = await upcomingEvents();
  const pickup = events.map(
    (e) =>
      `🎒 <b>${escapeHtml(e.title)}</b> (${dayMonth(e.date)}): ${pickupDaysText(e.date)} — ${escapeHtml(pickupPlace(e))}. ` +
      `Иногородним — в день старта ${raceDayPickupText(e.date)}.`,
  );
  return [
    faqHtml('fee'),
    '<b>Где и когда получить стартовый пакет</b>',
    ...(pickup.length > 0 ? pickup : ['Даты выдачи появятся вместе с расписанием сезона.']),
    'Возьмите документ, удостоверяющий личность.',
  ].join('\n\n');
}

export const TOPICS: { key: string; label: string; answer: () => Promise<string> | string }[] = [
  { key: 'races', label: 'Даты и места стартов', answer: racesAnswer },
  { key: 'price', label: 'Цена и оплата', answer: priceAnswer },
  { key: 'pack', label: 'Стартовый пакет', answer: packAnswer },
  { key: 'refund', label: 'Возврат и передача слота', answer: () => [faqHtml('refund'), faqHtml('transfer')].join('\n\n') },
  { key: 'minors', label: 'Если нет 18 лет', answer: () => faqHtml('age') },
  { key: 'bring', label: 'Что взять с собой', answer: () => [faqHtml('bring'), faqHtml('cloakroom')].join('\n\n') },
];

export const ASK_BUTTON: InlineButton = { text: '❓ Задать вопрос', callback_data: 'ask' };
export const PARTNER_BUTTON: InlineButton = { text: '🤝 Стать партнёром', callback_data: 'partner' };
const WRITE_BUTTON: InlineButton = { text: '✍️ Другой вопрос', callback_data: 'ask:write' };
const CANCEL_BUTTON: InlineButton = { text: 'Отмена', callback_data: 'support:cancel' };

const MENU_TEXT = '<b>Частые вопросы</b>\n\nВыберите тему — ответим сразу. Не нашли ответа — нажмите «Другой вопрос» и напишите нам.';

export async function sendSupportMenu(chatId: number): Promise<void> {
  const rows: InlineButton[][] = [];
  // По одной кнопке в ряд: в два столбца Telegram обрезает названия на телефоне.
  for (const t of TOPICS) rows.push([{ text: t.label, callback_data: `ask:${t.key}` }]);
  rows.push([WRITE_BUTTON], [PARTNER_BUTTON]);
  await sendMessage(String(chatId), MENU_TEXT, rows);
}

async function sendTopic(chatId: number, key: string): Promise<void> {
  const topic = TOPICS.find((t) => t.key === key);
  if (!topic) return sendSupportMenu(chatId);
  await sendMessage(String(chatId), await topic.answer(), [
    [{ text: 'Помогло', callback_data: 'ask:ok' }],
    [{ text: 'Не помогло — написать нам', callback_data: 'ask:write' }],
    [{ text: '⬅️ Другие вопросы', callback_data: 'ask' }],
  ]);
}

// ---------- Состояние: пишет вопрос / заполняет анкету ----------

const PARTNER_STEPS = [
  { key: 'name', ask: 'Как вас зовут?' },
  { key: 'company', ask: 'Какую компанию вы представляете?' },
  { key: 'phone', ask: 'Ваш телефон для связи?' },
  { key: 'offer', ask: 'Что вы предлагаете? Расскажите в одном сообщении.' },
] as const;

async function setState(telegramId: number, mode: 'question' | 'partner', step = 0, data: object = {}) {
  await prisma.supportState.upsert({
    where: { telegramId: BigInt(telegramId) },
    create: { telegramId: BigInt(telegramId), mode, step, data },
    update: { mode, step, data },
  });
}

async function clearState(telegramId: number) {
  await prisma.supportState.deleteMany({ where: { telegramId: BigInt(telegramId) } });
}

async function startQuestion(chatId: number, from: TgUser) {
  await setState(from.id, 'question');
  await sendMessage(
    String(chatId),
    '✍️ Напишите ваш вопрос одним сообщением — можно с фото. Ответим здесь, в этом чате.',
    [[CANCEL_BUTTON]],
  );
}

async function startPartner(chatId: number, from: TgUser) {
  await setState(from.id, 'partner', 0);
  await sendMessage(
    String(chatId),
    `🤝 Спасибо за интерес к 5&amp;5! Четыре коротких вопроса — и передадим вашу заявку команде.\n\n${PARTNER_STEPS[0].ask}`,
    [[CANCEL_BUTTON]],
  );
}

// ---------- Пересылка админам ----------

const STATUS_LABEL: Record<string, string> = { PAID: 'оплачено', PENDING: 'ждёт оплаты', CANCELLED: 'отменено' };

/** Карточка человека для админа: кто он и что у него с регистрациями. */
async function personCard(from: TgUser): Promise<string> {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'без имени';
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(from.id) },
    include: {
      registrations: { include: { event: true, distance: true }, orderBy: { event: { date: 'asc' } } },
      seasonPasses: { include: { season: true } },
    },
  });
  const lines = [
    `👤 ${escapeHtml(name)}${from.username ? ` · @${escapeHtml(from.username)}` : ''} · ID <code>${from.id}</code>`,
  ];
  if (user) {
    const fio = [user.lastName, user.firstName].filter(Boolean).join(' ');
    if (fio || user.phone) lines.push(`В анкете: ${escapeHtml(fio)}${user.phone ? `, ${escapeHtml(user.phone)}` : ''}`);
    for (const p of user.seasonPasses) {
      lines.push(`🎫 Абонемент «${escapeHtml(p.season.title)}» — ${p.refundedAt ? 'возврат' : STATUS_LABEL[p.paymentStatus]}`);
    }
    for (const r of user.registrations) {
      const status = r.refundedAt ? 'возврат' : r.manual ? 'добавлен вручную' : STATUS_LABEL[r.paymentStatus];
      lines.push(
        `• ${escapeHtml(r.event.title)}, ${dayMonth(r.event.date)}${r.distance ? `, ${escapeHtml(r.distance.label)}` : ''} — ${status}${r.seasonPassId ? ' (абонемент)' : ''}`,
      );
    }
    if (user.registrations.length === 0 && user.seasonPasses.length === 0) lines.push('Регистраций нет');
  } else {
    lines.push('В приложении не регистрировался');
  }
  return lines.join('\n');
}

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

/**
 * Карточка + копия сообщения каждому админу. Обе — в support_messages, чтобы
 * реплай на любую из них нашёл, кому отвечать.
 */
async function forwardToAdmins(
  msg: TgMessage,
  from: TgUser,
  kind: 'question' | 'followup',
  log: Logger,
): Promise<boolean> {
  const admins = [...adminTelegramIds()];
  if (admins.length === 0) {
    log.warn({ telegramId: from.id }, 'Поддержка: нет ADMIN_TELEGRAM_IDS — вопрос некому переслать');
    return false;
  }
  const title = kind === 'question' ? '❓ <b>Новый вопрос</b>' : '💬 <b>Ещё сообщение</b>';
  const header = `${title}\n${await personCard(from)}\n\n<i>Ответьте реплаем на это сообщение или на копию ниже — бот отправит ответ.</i>`;
  const text = (msg.text ?? msg.caption ?? (msg.photo ? '[фото]' : '[вложение]')).slice(0, 4000);
  let delivered = false;
  for (const admin of admins) {
    const chat = String(admin);
    const head = await sendMessage(chat, header);
    const copy = await copyMessage(chat, String(msg.chat.id), msg.message_id, { replyTo: head.ok ? head.messageId : undefined });
    for (const sent of [head, copy]) {
      if (sent.ok && sent.messageId) {
        delivered = true;
        await prisma.supportMessage.create({
          data: { telegramId: BigInt(from.id), direction: 'IN', kind, text, adminChatId: BigInt(admin), adminMessageId: sent.messageId },
        });
      }
    }
    if (!copy.ok) log.warn({ admin, error: copy.error }, 'Поддержка: не удалось переслать админу');
  }
  log.info({ telegramId: from.id, kind }, 'Поддержка: сообщение переслано админам');
  return delivered;
}

async function finishPartner(chatId: number, from: TgUser, data: Record<string, string>, log: Logger) {
  const text = [
    '🤝 <b>Заявка партнёра</b>',
    await personCard(from),
    '',
    `<b>Имя:</b> ${escapeHtml(data.name ?? '')}`,
    `<b>Компания:</b> ${escapeHtml(data.company ?? '')}`,
    `<b>Телефон:</b> ${escapeHtml(data.phone ?? '')}`,
    `<b>Предложение:</b> ${escapeHtml(data.offer ?? '')}`,
    '',
    '<i>Ответьте реплаем — бот отправит ответ.</i>',
  ].join('\n');
  for (const admin of adminTelegramIds()) {
    const sent = await sendMessage(String(admin), text);
    if (sent.ok && sent.messageId) {
      await prisma.supportMessage.create({
        data: {
          telegramId: BigInt(from.id),
          direction: 'IN',
          kind: 'partner',
          text: JSON.stringify(data).slice(0, 4000),
          adminChatId: BigInt(admin),
          adminMessageId: sent.messageId,
        },
      });
    }
  }
  log.info({ telegramId: from.id }, 'Поддержка: заявка партнёра');
  await sendMessage(String(chatId), 'Спасибо! Передали заявку команде 5&amp;5 — мы свяжемся с вами в ближайшее время.');
}

/** Ответ админа реплаем → человеку. true — это был ответ поддержки. */
async function relayAdminReply(msg: TgMessage, log: Logger): Promise<boolean> {
  const replyTo = msg.reply_to_message?.message_id;
  if (!replyTo || !msg.from || !adminTelegramIds().has(msg.from.id)) return false;
  const origin = await prisma.supportMessage.findFirst({
    where: { adminChatId: BigInt(msg.chat.id), adminMessageId: replyTo, direction: 'IN' },
  });
  if (!origin) return false;

  const to = String(origin.telegramId);
  const head = '💬 <b>Ответ команды 5&amp;5</b>';
  const sent = msg.text
    ? await sendMessage(to, `${head}\n\n${escapeHtml(msg.text)}`)
    : (await sendMessage(to, head)).ok
      ? await copyMessage(to, String(msg.chat.id), msg.message_id)
      : { ok: false as const, blocked: true, error: 'не доставлено' };

  if (!sent.ok) {
    await sendMessage(
      String(msg.chat.id),
      sent.blocked ? '⚠️ Не доставлено: человек остановил или заблокировал бота.' : `⚠️ Не доставлено: ${escapeHtml(sent.error)}`,
    );
    return true;
  }
  await prisma.supportMessage.create({
    data: { telegramId: origin.telegramId, direction: 'OUT', kind: 'reply', text: (msg.text ?? msg.caption ?? '[вложение]').slice(0, 4000) },
  });
  await sendMessage(String(msg.chat.id), '✓ Ответ отправлен.');
  // Остальным админам — что на вопрос уже ответили, чтобы не отвечать дважды.
  const who = msg.from.username ? `@${escapeHtml(msg.from.username)}` : escapeHtml(msg.from.first_name ?? 'админ');
  for (const admin of adminTelegramIds()) {
    if (admin === msg.from.id) continue;
    await sendMessage(String(admin), `↪️ ${who} ответил(а): ${escapeHtml((msg.text ?? '[вложение]').slice(0, 500))}`);
  }
  log.info({ telegramId: Number(origin.telegramId), admin: msg.from.id }, 'Поддержка: ответ отправлен');
  return true;
}

/** Открыта ли переписка: человек писал в поддержку за последние THREAD_DAYS. */
async function threadOpen(telegramId: number): Promise<boolean> {
  const since = new Date(Date.now() - THREAD_DAYS * 86_400_000);
  const last = await prisma.supportMessage.findFirst({
    where: { telegramId: BigInt(telegramId), direction: 'IN', kind: { in: ['question', 'followup'] }, createdAt: { gte: since } },
    select: { id: true },
  });
  return Boolean(last);
}

async function tooMany(telegramId: number): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000);
  const n = await prisma.supportMessage.count({
    where: { telegramId: BigInt(telegramId), direction: 'IN', createdAt: { gte: since } },
  });
  // Строк по числу админов × 2 на сообщение.
  return n >= MAX_PER_HOUR * Math.max(1, adminTelegramIds().size) * 2;
}

// ---------- Входящие ----------

/** Нажатие кнопки поддержки. true — обработано. */
export async function handleSupportCallback(data: string, chatId: number, from: TgUser): Promise<boolean> {
  if (data === 'ask') return sendSupportMenu(chatId).then(() => true);
  if (data === 'partner') return startPartner(chatId, from).then(() => true);
  if (data === 'support:cancel') {
    await clearState(from.id);
    await sendMessage(String(chatId), 'Хорошо, отменили. Если появится вопрос — нажмите «Задать вопрос».', [[ASK_BUTTON]]);
    return true;
  }
  if (data === 'ask:ok') {
    await sendMessage(String(chatId), 'Рады помочь! До встречи на старте 🙌');
    return true;
  }
  if (data === 'ask:write') return startQuestion(chatId, from).then(() => true);
  if (data.startsWith('ask:')) return sendTopic(chatId, data.slice(4)).then(() => true);
  return false;
}

/** Команды поддержки: /help (вопросы), /partner. */
export async function handleSupportCommand(command: string, chatId: number, from: TgUser): Promise<boolean> {
  if (command === '/help' || command === '/ask') return sendSupportMenu(chatId).then(() => true);
  if (command === '/partner') return startPartner(chatId, from).then(() => true);
  if (command === '/cancel') return handleSupportCallback('support:cancel', chatId, from);
  return false;
}

/**
 * Обычное сообщение (не команда): ответ админа, вопрос, шаг анкеты или
 * продолжение переписки. true — обработано поддержкой.
 */
export async function handleSupportMessage(msg: TgMessage, log: Logger): Promise<boolean> {
  const from = msg.from;
  if (!from) return false;
  if (await relayAdminReply(msg, log)) return true;

  const chatId = msg.chat.id;
  const state = await prisma.supportState.findUnique({ where: { telegramId: BigInt(from.id) } });

  if (state?.mode === 'partner') {
    const answer = (msg.text ?? msg.caption ?? '').trim();
    if (!answer) {
      await sendMessage(String(chatId), 'Напишите ответ текстом, пожалуйста.', [[CANCEL_BUTTON]]);
      return true;
    }
    const step = PARTNER_STEPS[state.step];
    const data = { ...(state.data as Record<string, string>), [step.key]: answer.slice(0, 1000) };
    const next = state.step + 1;
    if (next < PARTNER_STEPS.length) {
      await setState(from.id, 'partner', next, data);
      await sendMessage(String(chatId), PARTNER_STEPS[next].ask, [[CANCEL_BUTTON]]);
    } else {
      await clearState(from.id);
      await finishPartner(chatId, from, data, log);
    }
    return true;
  }

  const asking = state?.mode === 'question';
  if (!asking && !(await threadOpen(from.id))) return false;

  if (await tooMany(from.id)) {
    await sendMessage(String(chatId), 'Слишком много сообщений подряд — подождите немного, мы уже читаем.');
    return true;
  }
  if (asking) await clearState(from.id);
  const ok = await forwardToAdmins(msg, from, asking ? 'question' : 'followup', log);
  await sendMessage(
    String(chatId),
    !ok
      ? 'Не получилось передать сообщение — попробуйте ещё раз чуть позже.'
      : asking
        ? 'Спасибо! Мы свяжемся с вами в ближайшее время.'
        : '✓ Передали команде.',
  );
  return true;
}
