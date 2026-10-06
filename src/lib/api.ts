// Базовый URL бэкенда. Переопределяется через VITE_API_URL (.env),
// с запасным значением для локальной разработки.
import { getInitData } from './telegram';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export type EventDto = {
  id: number;
  title: string;
  date: string; // ISO
  location: string;
  distance: string;
  slotsTotal: number;
  slotsTaken: number;
  slotsLeft: number;
  price: number;
  /**
   * Карта трассы: путь относительно корня API («/uploads/routes/…»), который
   * админка получила при загрузке файла, или null, если карты у старта нет.
   * Для <img src> прогонять через apiAsset — базового адреса в значении нет.
   */
  routeImageUrl: string | null;
  createdAt: string;
};

/**
 * Абсолютная ссылка на файл, загруженный через админку. В БД лежит путь без
 * домена, потому что базовый адрес API у прода и локальной разработки разный.
 */
export function apiAsset(path: string): string {
  return `${API_URL}${path}`;
}

// email/age/phone заполняются не при входе, а при регистрации на старт,
// поэтому у только что вошедшего пользователя они пустые.
export type UserDto = {
  id: number;
  telegramId: string | null;
  username: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  /** Полных лет. Считает сервер из birthDate — отдельно не редактируется. */
  age: number | null;
  /** «1999-12-14» — тот же формат, что у input[type=date]. */
  birthDate: string | null;
  phone: string | null;
  createdAt: string;
};

export type RegistrationDto = {
  id: number;
  userId: number;
  eventId: number;
  paymentStatus: string;
  qrCode: string | null;
  registeredAt: string;
};

/**
 * Оплата через Kaspi (ApiPay). null — счёт не нужен: старт бесплатный или
 * оплата на сервере не настроена.
 */
export type PaymentState = 'CREATED' | 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

export type PaymentDto = {
  id: number;
  state: PaymentState;
  amount: number;
  /** Номер, на который выставлен счёт: 8XXXXXXXXXX. */
  phone: string;
  /** До какого момента держим место. */
  expiresAt: string;
  paidAt: string | null;
  /** Готовая фраза, когда счёт не выставился, отменён или истёк. */
  message: string | null;
};

/** Ждём ли ещё оплату по счёту. */
export function isPaymentOpen(p: PaymentDto): boolean {
  return p.state === 'CREATED' || p.state === 'PENDING';
}

export type RegistrationResult = {
  user: UserDto;
  registration: RegistrationDto;
  payment: PaymentDto | null;
};

export type RegistrationPayload = {
  eventId: number;
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  birthDate: string; // yyyy-mm-dd
  phone: string;
};

// Ошибка с HTTP-статусом от сервера — чтобы UI мог различать 409/400 и т.д.
export class ApiError extends Error {
  status: number;
  /**
   * Ошибки по полям формы, если сервер их прислал (400 от валидации):
   * `{ email: 'Некорректный email' }`. Пусто для всего остального.
   */
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
  }
}

/** 401 — initData отсутствует или просрочен: приложение надо переоткрыть. */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/**
 * Заголовок авторизации Telegram Mini App. Подписанный initData уходит с
 * КАЖДЫМ запросом: бэкенд проверяет подпись заново и не хранит сессий.
 */
function authHeaders(): Record<string, string> {
  const initData = getInitData();
  return initData ? { Authorization: `tma ${initData}` } : {};
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Сообщение, когда сервер не прислал своё (или его нельзя показывать). */
  fallback: (status: number) => string;
  /**
   * Показывать ли текст ошибки от сервера. Для POST — да: бэкенд присылает
   * готовые русские формулировки бизнес-отказов. Для GET — нет, иначе
   * пользователь увидит «Internal Server Error».
   */
  preferServerMessage?: boolean;
};

async function request<T>(path: string, opts: RequestOptions): Promise<T> {
  const { method = 'GET', body, fallback, preferServerMessage = false } = opts;

  const headers: Record<string, string> = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Не удалось связаться с сервером');
  }

  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const serverMessage =
      preferServerMessage &&
      data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null;

    // Пер-полевые тексты валидации (см. lib/validation.ts на бэке) — их UI
    // ставит под конкретное поле, а не общей плашкой.
    const raw = (data as { fields?: unknown } | null)?.fields;
    const fields: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') fields[key] = value;
      }
    }

    throw new ApiError(res.status, serverMessage ?? fallback(res.status), fields);
  }

  return data as T;
}

// ---------- Авторизация через Telegram ----------

export type AuthResult = {
  user: UserDto;
  /** true, если пользователь открыл приложение впервые. */
  isNew: boolean;
};

export type MeRegistrationDto = {
  id: number;
  eventId: number;
  seasonPassId: number | null;
  paymentStatus: string;
  qrCode: string | null;
  registeredAt: string;
  event: EventDto;
};

/**
 * Финишный результат участника. Всё, что есть в модели Result, плюс
 * finishersTotal — его сервер считает на лету по протоколу старта.
 * Отсортированы от старых стартов к новым.
 */
export type MeRaceResultDto = {
  id: number;
  eventId: number;
  finishTime: number; // секунды
  place: number; // место в общем зачёте
  finishersTotal: number; // сколько всего финишировало на этом старте
  recordedAt: string;
  event: EventDto;
};

export type MeResult = {
  user: UserDto;
  registrations: MeRegistrationDto[];
  results: MeRaceResultDto[];
  seasonPasses: SeasonPassDto[];
};

/**
 * Вход в приложение. Формы входа нет: отдаём подписанный Telegram initData,
 * сервер проверяет подпись и находит или создаёт пользователя по telegram_id.
 */
export function authTelegram(): Promise<AuthResult> {
  return request<AuthResult>('/auth/telegram', {
    method: 'POST',
    fallback: (s) => `Не удалось войти (${s})`,
  });
}

/** Профиль и всё, на что пользователь записан. */
export function getMe(): Promise<MeResult> {
  return request<MeResult>('/me', {
    fallback: (s) => `Не удалось загрузить профиль (${s})`,
  });
}

// age отдельным полем не правится: сервер считает его из даты рождения.
export type ProfilePatch = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  birthDate: string; // yyyy-mm-dd
  phone: string;
}>;

export function patchMe(patch: ProfilePatch): Promise<{ user: UserDto }> {
  return request<{ user: UserDto }>('/me', {
    method: 'PATCH',
    body: patch,
    preferServerMessage: true,
    fallback: (s) => `Не удалось сохранить профиль (${s})`,
  });
}

// ---------- Старты и регистрация ----------

export function getEvents(): Promise<EventDto[]> {
  return request<EventDto[]>('/events', {
    fallback: (s) => `Не удалось загрузить старты (${s})`,
  });
}

export function createRegistration(
  payload: RegistrationPayload,
): Promise<RegistrationResult> {
  return request<RegistrationResult>('/registrations', {
    method: 'POST',
    body: payload,
    preferServerMessage: true,
    fallback: (s) => `Ошибка (${s})`,
  });
}

// ---------- Сезон и абонемент 5&5 ----------

export type SeasonDto = {
  id: number;
  title: string;
  year: number;
  price: number;
  savings: number;
  events: EventDto[];
};

export type SeasonPassDto = {
  id: number;
  userId?: number;
  seasonId: number;
  price: number;
  paymentStatus: string;
  createdAt: string;
};

export type SeasonPassPayload = {
  seasonId: number;
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  birthDate: string; // yyyy-mm-dd
  phone: string;
};

export type SeasonPassResult = {
  user: UserDto;
  seasonPass: SeasonPassDto;
  registrations: RegistrationDto[];
  payment: PaymentDto | null;
};

// Активный сезон. Возвращает null, если сезона нет (404) — тогда UI
// откатывается к одиночной регистрации без опции абонемента.
export async function getCurrentSeason(): Promise<SeasonDto | null> {
  try {
    return await request<SeasonDto>('/seasons/current', {
      fallback: (s) => `Не удалось загрузить сезон (${s})`,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function createSeasonPass(
  payload: SeasonPassPayload,
): Promise<SeasonPassResult> {
  return request<SeasonPassResult>('/season-passes', {
    method: 'POST',
    body: payload,
    preferServerMessage: true,
    fallback: (s) => `Ошибка (${s})`,
  });
}

// ---------- Оплата ----------

/**
 * Статус оплаты. Экран «Оплатите в Kaspi» опрашивает его, пока счёт открыт;
 * сервер при этом сам сверяется с ApiPay, если вебхук ещё не пришёл.
 */
export async function getPayment(id: number): Promise<PaymentDto> {
  const res = await request<{ payment: PaymentDto }>(`/payments/${id}`, {
    fallback: (s) => `Не удалось проверить оплату (${s})`,
  });
  return res.payment;
}
