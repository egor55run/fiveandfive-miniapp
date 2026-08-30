/**
 * Исходящие сообщения участникам через Telegram Bot API.
 *
 * Тот же BOT_TOKEN, которым проверяются подписи initData (lib/telegramAuth.ts),
 * только здесь он используется наоборот — чтобы писать самим. Зависимостей нет:
 * нативный fetch из Node 20+.
 *
 * ВАЖНОЕ ОГРАНИЧЕНИЕ ПЛАТФОРМЫ: бот не может написать первым тому, кто не
 * открывал с ним диалог. Такой запрос вернёт 403, и обойти это нельзя — поэтому
 * 403 трактуется отдельно от настоящих сбоев (см. SendOutcome.blocked) и в
 * повторную отправку не уходит.
 */

const API_ORIGIN = 'https://api.telegram.org';

/** Дольше ждать нет смысла: вызов делается внутри HTTP-запроса участника. */
const TIMEOUT_MS = 10_000;

/**
 * Пауза между сообщениями при массовой рассылке. У Telegram лимит около 30
 * сообщений в секунду на бота; 50 мс дают ~20/с — с запасом, но всё ещё
 * достаточно быстро, чтобы разослать напоминания на 2000 участников за минуту.
 */
const THROTTLE_MS = 50;

export type SendOutcome =
  | { ok: true }
  /** blocked — 403: диалог не начат или бот заблокирован. Повторять бесполезно. */
  | { ok: false; blocked: boolean; error: string };

type TelegramError = {
  description?: string;
  parameters?: { retry_after?: number };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Экранирование под parse_mode: HTML. Полный список из документации Telegram. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Настроена ли отправка вообще. Без токена писать нечем. */
export function botConfigured(): boolean {
  return Boolean(process.env.BOT_TOKEN);
}

async function callSendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<Response> {
  return fetch(`${API_ORIGIN}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      // Ссылка на fiveandfive.kz есть почти в каждом сообщении, и превью сайта
      // раздувало бы его вдвое.
      link_preview_options: { is_disabled: true },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Отправить одно сообщение. Не бросает: любой сбой возвращается значением,
 * потому что вызывающая сторона (регистрация, внесение результата) не должна
 * падать из-за того, что Telegram недоступен.
 *
 * 429 повторяется один раз с задержкой, которую назвал сам Telegram.
 */
export async function sendMessage(
  chatId: string,
  text: string,
): Promise<SendOutcome> {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, blocked: false, error: 'BOT_TOKEN не задан' };

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await callSendMessage(token, chatId, text);
    } catch (err) {
      // Таймаут или сетевая ошибка — сюда же попадает AbortError.
      return {
        ok: false,
        blocked: false,
        error: err instanceof Error ? err.message : 'Сеть недоступна',
      };
    }

    if (res.ok) return { ok: true };

    const body = (await res.json().catch(() => null)) as TelegramError | null;
    const description = body?.description ?? `HTTP ${res.status}`;

    // Слишком часто: Telegram сам говорит, сколько ждать. Пробуем ровно один раз.
    if (res.status === 429 && attempt === 0) {
      const retryAfter = body?.parameters?.retry_after ?? 1;
      await sleep(Math.min(retryAfter, 30) * 1000);
      continue;
    }

    return { ok: false, blocked: res.status === 403, error: description };
  }

  return { ok: false, blocked: false, error: 'Не удалось отправить после повтора' };
}

/**
 * Массовая отправка с троттлингом. Возвращает результаты в том же порядке,
 * что и вход, — вызывающая сторона по ним пишет журнал.
 */
export async function sendMessages(
  messages: { chatId: string; text: string }[],
): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];
  for (const [index, message] of messages.entries()) {
    if (index > 0) await sleep(THROTTLE_MS);
    outcomes.push(await sendMessage(message.chatId, message.text));
  }
  return outcomes;
}
