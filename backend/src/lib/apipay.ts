import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Клиент ApiPay.kz — сервис, который выставляет счёт в Kaspi по номеру
 * телефона и сообщает об оплате вебхуком.
 *
 * Документация: https://apipay.kz/openapi.json (сверено с версией 2.1.0)
 *   POST /invoices          — выставить счёт (phone_number 8XXXXXXXXXX, amount
 *                             числом). Асинхронно: сначала status=processing,
 *                             затем pending или error.
 *   GET  /invoices/{id}     — текущий статус (лимит 1000 запросов в минуту)
 *   POST /invoices/{id}/cancel
 * Авторизация — заголовок X-API-Key. Вебхук подписан
 * `X-Webhook-Signature: sha256=<hmac_sha256(raw_body, webhook_secret)>`.
 *
 * Песочница — режим организации в кабинете ApiPay, а не отдельный адрес: в
 * Kaspi она не ходит, у счетов is_sandbox=true, оплату можно симулировать
 * через POST /invoices/{id}/simulate-status.
 *
 * Здесь только HTTP и форматы ApiPay. Что делать с регистрацией после оплаты —
 * в lib/payments.ts.
 */

const DEFAULT_BASE_URL = 'https://api.apipay.kz/api/v1';
const TIMEOUT_MS = 10_000;

/** Статусы счёта из спецификации ApiPay. */
export type ApiPayStatus =
  | 'processing'
  | 'pending'
  | 'cancelling'
  | 'paid'
  | 'cancelled'
  | 'expired'
  | 'partially_refunded'
  | 'error';

export type ApiPayInvoice = {
  id: number;
  status: ApiPayStatus | string;
  amount?: string;
  phone_number?: string | null;
  external_order_id?: string | null;
  paid_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  is_sandbox?: boolean;
};

export class ApiPayError extends Error {
  constructor(
    message: string,
    /** HTTP-статус ответа; 0 — запрос не дошёл (сеть, таймаут). */
    public status: number,
    /** error_code из тела ответа, если ApiPay его прислал. */
    public code: string | null = null,
  ) {
    super(message);
    this.name = 'ApiPayError';
  }
}

function apiKey(): string | null {
  const key = process.env.APIPAY_API_KEY?.trim();
  return key ? key : null;
}

function baseUrl(): string {
  return (process.env.APIPAY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** Настроена ли оплата. Без ключа приложение работает по-старому — без счёта. */
export function apiPayConfigured(): boolean {
  return apiKey() !== null;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const key = apiKey();
  if (!key) throw new ApiPayError('APIPAY_API_KEY не задан', 0, 'not_configured');

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiPayError(`ApiPay недоступен: ${(err as Error).message}`, 0);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Не JSON — оставляем null, ниже покажем кусок текста.
  }

  if (!res.ok) {
    const obj = (data ?? {}) as {
      message?: unknown;
      error?: unknown;
      error_code?: unknown;
      errors?: unknown;
    };
    const message =
      // 422: message всегда «Validation failed», суть — в errors по полям.
      fieldErrors(obj.errors) ||
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.error === 'string' && obj.error) ||
      text.slice(0, 300) ||
      `HTTP ${res.status}`;
    const code = typeof obj.error_code === 'string' ? obj.error_code : null;
    throw new ApiPayError(message, res.status, code);
  }

  return unwrapInvoice(data) as T;
}

/** `{ phone_number: ['…'] }` → «phone_number: …». null — ошибок по полям нет. */
function fieldErrors(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') return null;
  const parts = Object.entries(errors as Record<string, unknown>).map(
    ([field, list]) => `${field}: ${Array.isArray(list) ? list.join('; ') : String(list)}`,
  );
  return parts.length > 0 ? parts.join(' | ') : null;
}

/**
 * Некоторые ответы ApiPay заворачивают счёт в `invoice` (отмена и симуляция
 * в песочнице — `{ message, invoice }`), создание и GET отдают его как есть.
 * Достаём сам счёт, чтобы остальной код не гадал о форме ответа.
 */
function unwrapInvoice(data: unknown): unknown {
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (obj.id === undefined) {
      for (const key of ['invoice', 'data']) {
        const inner = obj[key];
        if (inner && typeof inner === 'object' && (inner as { id?: unknown }).id !== undefined) {
          return inner;
        }
      }
    }
  }
  return data;
}

export type CreateInvoiceInput = {
  /** 8XXXXXXXXXX */
  phone: string;
  /** Целые тенге. */
  amount: number;
  /** Видит покупатель в Kaspi; ApiPay обрежет до 60 символов, режем сами. */
  description: string;
  /** Наш id платежа — для сверки в кабинете ApiPay. */
  externalOrderId: string;
  /**
   * Кто платит — в internal_comment: видно только нам в кабинете ApiPay, в Kaspi
   * не уходит. Поля client_name при создании счёта у ApiPay нет.
   */
  clientName?: string;
};

export function createInvoice(input: CreateInvoiceInput): Promise<ApiPayInvoice> {
  if (!Number.isInteger(input.amount) || input.amount < 1) {
    throw new ApiPayError('Сумма счёта должна быть целым числом тенге', 0, 'bad_amount');
  }
  return call<ApiPayInvoice>('POST', '/invoices', {
    phone_number: input.phone,
    // Число, а не строка: дробная сумма → 422 amount_must_be_whole_tenge.
    amount: input.amount,
    // Длиннее 60 символов ApiPay отклоняет (422 description_too_long).
    description: input.description.slice(0, 60),
    external_order_id: input.externalOrderId,
    ...(input.clientName ? { internal_comment: input.clientName.slice(0, 255) } : {}),
  });
}

export function getInvoice(id: number): Promise<ApiPayInvoice> {
  return call<ApiPayInvoice>('GET', `/invoices/${id}`);
}

export function cancelInvoice(id: number): Promise<ApiPayInvoice> {
  return call<ApiPayInvoice>('POST', `/invoices/${id}/cancel`, {});
}

/**
 * Проверка подписи вебхука. Секрет — APIPAY_WEBHOOK_SECRET из кабинета ApiPay
 * (не API-ключ). Без секрета вебхук не принимаем вовсе: иначе кто угодно смог
 * бы «оплатить» регистрацию POST-запросом.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined): boolean {
  const secret = process.env.APIPAY_WEBHOOK_SECRET?.trim();
  if (!secret || !header) return false;

  const received = header.trim().replace(/^sha256=/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * id счёта из тела вебхука. Документирована форма `{ event, invoice: { id, … } }`,
 * но смотрим и на плоский вариант — статус всё равно перепроверяем GET-запросом.
 */
export function invoiceIdFromWebhook(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  const candidates = [
    (obj.invoice as Record<string, unknown> | undefined)?.id,
    (obj.data as Record<string, unknown> | undefined)?.id,
    obj.invoice_id,
    obj.id,
  ];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : c;
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export const KASPI_PHONE_ERROR =
  'Нужен казахстанский мобильный номер, привязанный к Kaspi: +7 7XX XXX XX XX';

/**
 * Номер для ApiPay: 8XXXXXXXXXX. Участник может ввести +7 (777) 123-45-67,
 * 87771234567, 7771234567 — всё приводим к одному виду. null — это не
 * казахстанский мобильный номер, счёт на него не выставить.
 */
export function normalizeKzPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let local: string | null = null;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    local = digits.slice(1);
  } else if (digits.length === 10) {
    local = digits;
  }
  // Мобильные номера Казахстана начинаются с 7 (700–778 и т.п.).
  if (!local || !local.startsWith('7')) return null;
  return `8${local}`;
}
