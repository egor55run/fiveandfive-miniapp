import { prisma } from '../prisma';
import { ApiPayError } from './apipay';
import { startOfDayInTz, ymdInTz } from './notify';
import { sendMessage } from './telegramBot';
import { adminTelegramIds } from './telegramLogin';

/**
 * Дневной лимит счетов Kaspi. Тариф ApiPay «Бизнес» — 100 счетов в день
 * (решение пользователя 2026-10-18). Когда лимит выбран, новые регистрации
 * получают «попробуйте позже» ещё до того, как займут место, — места не
 * пропадают. Владельцу — сообщение в Telegram, когда за день выставлено
 * APIPAY_DAILY_WARN счетов, и ещё одно, когда лимит выбран.
 *
 * Считаем сами: счета, созданные с полуночи по Астане (когда ApiPay обнуляет
 * свой счётчик, в документации не сказано — если раньше нас, мы просто
 * откроемся чуть позже). Если ApiPay всё-таки ответит «лимит», это тоже
 * превращается в «попробуйте позже» (см. isLimitError).
 *
 * Настройки (backend/.env):
 *   APIPAY_DAILY_LIMIT=100   (по умолчанию)
 *   APIPAY_DAILY_WARN=80     (по умолчанию)
 */

export const INVOICE_LIMIT_ERROR = 'daily_limit';

export const INVOICE_LIMIT_MESSAGE =
  'Сейчас не можем выставить счёт в Kaspi — попробуйте позже. Место за вами не закреплено, деньги не списаны';

export function dailyInvoiceLimit(): number {
  const n = Number(process.env.APIPAY_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

function warnAt(): number {
  const n = Number(process.env.APIPAY_DAILY_WARN);
  return Number.isInteger(n) && n > 0 ? n : 80;
}

/**
 * Счета за сегодня: выставленные (есть id счёта ApiPay) и те, что
 * выставляются прямо сейчас (CREATED), — чтобы параллельные запросы не
 * проскочили лимит.
 */
export function invoicesToday(now: Date = new Date()): Promise<number> {
  return prisma.payment.count({
    where: {
      createdAt: { gte: startOfDayInTz(now) },
      OR: [{ providerInvoiceId: { not: null } }, { state: 'CREATED' }],
    },
  });
}

export async function invoiceLimitReached(): Promise<boolean> {
  return (await invoicesToday()) >= dailyInvoiceLimit();
}

/**
 * Ждёт ли у человека неоплаченный счёт — тогда «лимит» ему не показываем:
 * повторное нажатие вернёт тот же счёт, нового не будет.
 */
export async function hasActiveInvoice(userId: number): Promise<boolean> {
  const found = await prisma.payment.findFirst({
    where: { userId, state: { in: ['CREATED', 'PENDING'] }, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(found);
}

/** Ответ ApiPay похож на «лимит/слишком часто». */
export function isLimitError(err: unknown): boolean {
  if (!(err instanceof ApiPayError)) return false;
  return err.status === 429 || /limit|quota|лимит/i.test(`${err.code ?? ''} ${err.message}`);
}

// Какие пороги уже сообщили — по дню. В памяти: после перезапуска API
// в тот же день сообщение может прийти ещё раз, это не страшно.
const alerted = new Map<string, Set<'warn' | 'limit'>>();

type Logger = { warn: (o: object, m: string) => void };

/** После выставленного счёта: не пора ли сказать владельцу. Не бросает. */
export async function checkInvoiceAlerts(log: Logger, opts: { apiPayLimit?: boolean } = {}): Promise<void> {
  try {
    const day = ymdInTz(new Date());
    const count = await invoicesToday();
    const kind: 'warn' | 'limit' | null =
      opts.apiPayLimit || count >= dailyInvoiceLimit() ? 'limit' : count >= warnAt() ? 'warn' : null;
    if (!kind) return;
    const sent = alerted.get(day) ?? new Set();
    if (sent.has(kind)) return;
    sent.add(kind);
    alerted.clear();
    alerted.set(day, sent);

    const text =
      kind === 'warn'
        ? `⚠️ Kaspi: за сегодня выставлено ${count} счетов из ${dailyInvoiceLimit()}. Когда лимит кончится, новые регистрации получат «попробуйте позже» до полуночи.`
        : opts.apiPayLimit
          ? `⛔ Kaspi: ApiPay отказал в новом счёте из-за лимита (у нас за сегодня ${count}). Регистрации получают «попробуйте позже». Места не теряются.`
          : `⛔ Kaspi: дневной лимит ${dailyInvoiceLimit()} счетов выбран. До полуночи новые регистрации получают «попробуйте позже». Места не теряются.`;
    for (const id of adminTelegramIds()) {
      const res = await sendMessage(String(id), text);
      if (!res.ok) log.warn({ telegramId: id, error: res.error }, 'Не удалось сообщить о лимите счетов');
    }
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Сбой проверки лимита счетов');
  }
}
