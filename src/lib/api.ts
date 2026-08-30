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
  createdAt: string;
};

// email/age/phone заполняются не при входе, а при регистрации на старт,
// поэтому у только что вошедшего пользователя они пустые.
export type UserDto = {
  id: number;
  telegramId: string | null;
  username: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  age: number | null;
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

export type RegistrationResult = {
  user: UserDto;
  registration: RegistrationDto;
  payment: { status: string; message: string };
};

export type RegistrationPayload = {
  eventId: number;
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  phone: string;
};

// Ошибка с HTTP-статусом от сервера — чтобы UI мог различать 409/400 и т.д.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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
    throw new ApiError(res.status, serverMessage ?? fallback(res.status));
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

export type ProfilePatch = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  age: number;
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
  phone: string;
};

export type SeasonPassResult = {
  user: UserDto;
  seasonPass: SeasonPassDto;
  registrations: RegistrationDto[];
  payment: { status: string; message: string };
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
