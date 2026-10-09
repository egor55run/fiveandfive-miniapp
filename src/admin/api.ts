// Клиент админского API. Авторизация — httpOnly cookie, поставленная
// POST /admin/session; в JS токена нет и достать его нельзя.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class AdminApiError extends Error {
  status: number;
  reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.reason = reason;
  }
}

export const isUnauthorized = (err: unknown) =>
  err instanceof AdminApiError && (err.status === 401 || err.status === 403);

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = 'GET', body } = init;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      // Cookie сессии обязана уйти вместе с запросом.
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(0, 'Не удалось связаться с сервером');
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; reason?: string };
    throw new AdminApiError(
      res.status,
      obj.error ?? `Ошибка ${res.status}`,
      obj.reason,
    );
  }
  return data as T;
}

// ---------- Вход ----------

export type AdminInfo = { telegramId: string; firstName?: string | null; username?: string | null };

/** Payload, который Telegram Login Widget отдаёт в колбэк. */
export type WidgetPayload = Record<string, string | number>;

export const loginWithWidget = (payload: WidgetPayload) =>
  request<{ admin: AdminInfo; via: string; expiresAt: string }>('/admin/session', {
    method: 'POST',
    body: payload,
  });

/** Вход изнутри Telegram: тот же эндпоинт, но личность из initData. */
export async function loginWithInitData(initData: string) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/session`, {
      method: 'POST',
      headers: { Authorization: `tma ${initData}` },
      credentials: 'same-origin',
    });
  } catch {
    throw new AdminApiError(0, 'Не удалось связаться с сервером');
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; reason?: string };
    throw new AdminApiError(res.status, obj.error ?? `Ошибка ${res.status}`, obj.reason);
  }
  return data as { admin: AdminInfo; via: string };
}

export const getAdminMe = () => request<{ admin: AdminInfo }>('/admin/me');
export const logout = () => request<{ ok: true }>('/admin/session', { method: 'DELETE' });

// ---------- Старты ----------

export type SeasonOption = {
  id: number;
  title: string;
  year: number;
  price: number;
  isActive: boolean;
};

export type AdminEvent = {
  id: number;
  title: string;
  date: string;
  location: string;
  distance: string;
  slotsTotal: number;
  slotsTaken: number;
  slotsLeft: number;
  price: number;
  /** Путь к загруженной карте трассы относительно корня API, или null. */
  routeImageUrl: string | null;
  /** Адрес страницы на сайте: /starty/<slug>. */
  slug: string | null;
  program: string | null;
  /** Путь к PDF Положения относительно корня API, или null. */
  regulationsUrl: string | null;
  /** Когда закрывается регистрация — итоговая дата (заданная или за 7 дней до старта). */
  registrationClosesAt: string;
  /** Как задано в админке; null — по умолчанию. */
  registrationClosesAtCustom: string | null;
  createdAt: string;
  season: { id: number; title: string; year: number } | null;
  registrations: { total: number; pending: number; paid: number; cancelled: number };
  resultsCount: number;
};

export type EventInput = {
  title: string;
  date: string; // ISO
  location: string;
  distance: string;
  price: number;
  slotsTotal: number;
  seasonId: number | null;
  /** ISO или null — по умолчанию за 7 дней до старта. */
  registrationClosesAt: string | null;
  /** null — сервер составит из названия и года. */
  slug: string | null;
  program: string | null;
};

export const getSeasons = () => request<SeasonOption[]>('/admin/seasons');
export const getEvents = () => request<AdminEvent[]>('/admin/events');
export const createEvent = (input: EventInput) =>
  request<AdminEvent>('/admin/events', { method: 'POST', body: input });
export const updateEvent = (id: number, input: Partial<EventInput>) =>
  request<AdminEvent>(`/admin/events/${id}`, { method: 'PATCH', body: input });
export const deleteEvent = (id: number, force = false) =>
  request<{ ok: true; deleted: { registrations: number; results: number } }>(
    `/admin/events/${id}${force ? '?force=1' : ''}`,
    { method: 'DELETE' },
  );

// ---------- Карта трассы ----------

/** Что принимает сервер (проверяет по содержимому файла, а не по этим строкам). */
export const ROUTE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
export const ROUTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Абсолютная ссылка на загруженный файл: в БД лежит путь без домена. */
export const assetUrl = (path: string) => `${API_URL}${path}`;

/**
 * Ответ роутов карты — сериализованный старт, но без счётчиков и сезона,
 * которыми список обрастает в GET /admin/events. Берём из него только то, что
 * там точно есть: свежий список UI всё равно перезагружает.
 */
export type RouteImageResult = { id: number; routeImageUrl: string | null };

/**
 * Загрузка карты трассы. Идёт не через request(): тело здесь multipart, а не
 * JSON, и Content-Type должен поставить сам браузер — вместе с boundary.
 */
export async function uploadRouteImage(
  eventId: number,
  file: File,
): Promise<RouteImageResult> {
  const body = new FormData();
  body.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/events/${eventId}/route-image`, {
      method: 'POST',
      credentials: 'same-origin',
      body,
    });
  } catch {
    throw new AdminApiError(0, 'Не удалось связаться с сервером');
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; reason?: string };
    // 413 без JSON — это nginx, а не наш обработчик: у него свой лимит на тело
    // запроса (client_max_body_size, по умолчанию 1 МБ), и до бэкенда файл не
    // дошёл. Иначе администратор увидел бы бессмысленную «Ошибка 413».
    if (res.status === 413 && !obj.error) {
      throw new AdminApiError(
        413,
        'Файл отклонён веб-сервером как слишком большой. Уменьшите картинку или поднимите client_max_body_size в nginx.',
        'nginx_limit',
      );
    }
    throw new AdminApiError(res.status, obj.error ?? `Ошибка ${res.status}`, obj.reason);
  }
  return data as AdminEvent;
}

/** Убрать карту: в приложении у старта снова будет плейсхолдер. */
export const deleteRouteImage = (eventId: number) =>
  request<RouteImageResult>(`/admin/events/${eventId}/route-image`, { method: 'DELETE' });

/** Положение — PDF до 7 МБ (backend/src/lib/regulations.ts). */
export const REGULATIONS_MAX_BYTES = 7 * 1024 * 1024;

export async function uploadRegulations(eventId: number, file: File): Promise<AdminEvent> {
  const body = new FormData();
  body.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/events/${eventId}/regulations`, {
      method: 'POST',
      credentials: 'same-origin',
      body,
    });
  } catch {
    throw new AdminApiError(0, 'Не удалось связаться с сервером');
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; reason?: string };
    // 413 без JSON — это лимит nginx (8 МБ), до бэкенда файл не дошёл.
    if (res.status === 413 && !obj.error) {
      throw new AdminApiError(413, 'Файл больше 8 МБ — веб-сервер его не принял', 'nginx_limit');
    }
    throw new AdminApiError(res.status, obj.error ?? `Ошибка ${res.status}`, obj.reason);
  }
  return data as AdminEvent;
}

/** Убрать Положение со страницы старта. */
export const deleteRegulations = (eventId: number) =>
  request<AdminEvent>(`/admin/events/${eventId}/regulations`, { method: 'DELETE' });

// ---------- Участники ----------

export type PaymentStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export type Participant = {
  registrationId: number;
  userId: number;
  lastName: string | null;
  firstName: string;
  phone: string | null;
  email: string | null;
  age: number | null;
  /** Полных лет на день этого старта; null — дата рождения неизвестна. */
  ageOnStart: number | null;
  telegramId: string | null;
  username: string | null;
  paymentStatus: PaymentStatus;
  qrCode: string | null;
  seasonPassId: number | null;
  registeredAt: string;
  result: { id: number; finishTime: number; place: number } | null;
};

export type ParticipantsResponse = {
  event: { id: number; title: string; date: string };
  participants: Participant[];
};

export const getParticipants = (eventId: number) =>
  request<ParticipantsResponse>(`/admin/events/${eventId}/participants`);

export const setPaymentStatus = (registrationId: number, paymentStatus: PaymentStatus) =>
  request<{
    registrationId: number;
    paymentStatus: PaymentStatus;
    slotsChanged: number;
    event: { id: number; slotsTaken: number; slotsTotal: number; slotsLeft: number } | null;
  }>(`/admin/registrations/${registrationId}`, { method: 'PATCH', body: { paymentStatus } });

// ---------- Результаты ----------

export type ResultRow = {
  id: number;
  userId: number;
  lastName: string | null;
  firstName: string;
  username: string | null;
  finishTime: number;
  place: number;
  recordedAt: string;
};

export type ResultsResponse = {
  event: { id: number; title: string; date: string; distance: string };
  results: ResultRow[];
};

export const getResults = (eventId: number) =>
  request<ResultsResponse>(`/admin/events/${eventId}/results`);

/** Место не передаём — его считает сервер сортировкой по времени. */
export const putResult = (eventId: number, userId: number, finishTime: number) =>
  request<{ results: ResultRow[] }>(`/admin/events/${eventId}/results`, {
    method: 'PUT',
    body: { userId, finishTime },
  });

export const deleteResult = (resultId: number) =>
  request<{ results: ResultRow[] }>(`/admin/results/${resultId}`, { method: 'DELETE' });

// ---------- Подписка «Узнать об открытии» ----------

export type OpeningInfo = {
  stats: {
    active: number;
    pending: number;
    sent: number;
    blocked: number;
    failed: number;
    unsubscribed: number;
  };
  broadcast: {
    running: boolean;
    total: number;
    done: number;
    sent: number;
    blocked: number;
    failed: number;
    startedAt: string | null;
    finishedAt: string | null;
  };
  defaultText: string;
  registrationOpen: boolean;
};

export const getOpeningSubscribers = () => request<OpeningInfo>('/admin/opening-subscribers');

export const startOpeningBroadcast = (text: string) =>
  request<{ broadcast: OpeningInfo['broadcast'] }>('/admin/opening-subscribers/broadcast', {
    method: 'POST',
    body: { text },
  });
