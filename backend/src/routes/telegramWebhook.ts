import { timingSafeEqual } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { prisma } from '../prisma';
import { appUrl, subscribe, unsubscribe } from '../lib/openingSubscribers';
import { registrationOpen } from '../lib/registrationWindow';
import { answerCallbackQuery, sendMessage, type InlineButton } from '../lib/telegramBot';

/**
 * Входящие сообщения боту (вебхук Telegram, этап 2 сайта).
 *
 * Бот понимает немного: /start (в том числе /start notify-<slug> с кнопки сайта
 * «Узнать об открытии в Telegram»), кнопку «Сообщить об открытии регистрации» и
 * /stop. На всё остальное отвечает кнопкой приложения — разговаривать бот не
 * должен, всё делается в Mini App.
 *
 * Снаружи: https://<домен>/api/telegram/webhook. Адрес и секрет сообщает
 * Telegram скрипт dist/jobs/setWebhook.js (см. backend/README.md).
 */

type TgUser = { id: number; first_name?: string; username?: string };
type Update = {
  message?: { chat: { id: number; type: string }; from?: TgUser; text?: string };
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number } } };
};

const SUBSCRIBED_TEXT = [
  '🔔 <b>Готово!</b> Напишем сюда, как только откроется регистрация на забеги 5&amp;5.',
  '',
  'Отписаться — /stop',
].join('\n');

const ALREADY_OPEN_TEXT = 'Регистрация уже открыта — выбирайте старт и записывайтесь в приложении.';

const WELCOME_TEXT = [
  'Привет! Это бот серии забегов <b>5&amp;5</b> — пять забегов по 5 км в парках Астаны.',
  '',
  'Старты, регистрация и результаты — в приложении.',
].join('\n');

const UNSUBSCRIBED_TEXT =
  'Хорошо, больше не напишем об открытии регистрации. Передумаете — нажмите /start.';

const appButton = (slug?: string): InlineButton => ({
  text: 'Открыть приложение',
  web_app: { url: slug ? `${appUrl()}?race=${encodeURIComponent(slug)}` : appUrl() },
});
const NOTIFY_BUTTON: InlineButton = {
  text: '🔔 Сообщить об открытии регистрации',
  callback_data: 'notify',
};

/** Секрет из заголовка совпадает с нашим? Без секрета в .env — не пускаем никого. */
function secretOk(header: string | string[] | undefined): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const got = Array.isArray(header) ? header[0] : header;
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleStart(chatId: number, from: TgUser, payload: string | undefined) {
  const chat = String(chatId);
  // Кнопка сайта: /start notify-<slug> (или просто notify).
  if (payload?.startsWith('notify')) {
    const slug = payload.startsWith('notify-') ? payload.slice('notify-'.length) : undefined;
    if (registrationOpen()) {
      await sendMessage(chat, ALREADY_OPEN_TEXT, [[appButton(slug)]]);
      return;
    }
    await subscribe(from, payload.slice(0, 120));
    await sendMessage(chat, SUBSCRIBED_TEXT, [[appButton(slug)]]);
    return;
  }

  // Обычный /start: приложение и, пока регистрация закрыта, — подписка.
  const subscribed = await prisma.openingSubscriber.findFirst({
    where: { telegramId: BigInt(from.id), unsubscribedAt: null },
    select: { id: true },
  });
  const rows: InlineButton[][] = [[appButton()]];
  if (!registrationOpen() && !subscribed) rows.push([NOTIFY_BUTTON]);
  await sendMessage(chat, WELCOME_TEXT, rows);
}

async function handleUpdate(update: Update, log: FastifyBaseLogger) {
  const cb = update.callback_query;
  if (cb) {
    if (cb.data === 'notify') {
      if (registrationOpen()) {
        await answerCallbackQuery(cb.id, 'Регистрация уже открыта!');
        if (cb.message) await sendMessage(String(cb.message.chat.id), ALREADY_OPEN_TEXT, [[appButton()]]);
        return;
      }
      await subscribe(cb.from, 'bot');
      await answerCallbackQuery(cb.id, 'Готово! Напишем, когда откроется регистрация');
      if (cb.message) await sendMessage(String(cb.message.chat.id), SUBSCRIBED_TEXT);
      log.info({ telegramId: cb.from.id }, 'Подписка на открытие регистрации (кнопка в боте)');
    } else {
      await answerCallbackQuery(cb.id);
    }
    return;
  }

  const msg = update.message;
  // Только личные чаты: в группы бот не ходит.
  if (!msg?.from || msg.chat.type !== 'private') return;
  const text = msg.text?.trim() ?? '';
  const [command, payload] = text.split(/\s+/, 2);

  if (command === '/start') {
    await handleStart(msg.chat.id, msg.from, payload);
    if (payload?.startsWith('notify')) {
      log.info({ telegramId: msg.from.id, payload }, 'Подписка на открытие регистрации (сайт)');
    }
    return;
  }
  if (command === '/stop') {
    await unsubscribe(msg.from.id);
    await sendMessage(String(msg.chat.id), UNSUBSCRIBED_TEXT);
    return;
  }
  // Всё остальное — коротко отправляем в приложение.
  await sendMessage(String(msg.chat.id), 'Всё про забеги 5&amp;5 — в приложении:', [[appButton()]]);
}

export async function telegramWebhookRoutes(app: FastifyInstance) {
  app.post('/telegram/webhook', async (req, reply) => {
    if (!secretOk(req.headers['x-telegram-bot-api-secret-token'])) {
      req.log.warn({ ip: req.ip }, 'Вебхук Telegram без верного секрета отклонён');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    // Telegram ждёт быстрый ответ — обрабатываем после него. Ошибки — только в
    // лог: повтор того же сообщения от Telegram нам не нужен.
    const update = req.body as Update;
    const log = req.log;
    setImmediate(() => {
      handleUpdate(update, log).catch((err) =>
        log.error({ err: String(err) }, 'Вебхук Telegram: сбой обработки'),
      );
    });
    return { ok: true };
  });
}
