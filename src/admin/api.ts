// Клиент админского API. Авторизация — httpOnly cookie, поставленная
// POST /admin/session; в JS токена нет и достать его нельзя.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class AdminApiError extends Error {
  status: number;
  reason?: string;
  /** Ошибки по полям формы (ответ 400 с reason=validation). */
  fields?: Record<string, string>;
  constructor(status: number, message: string, reason?: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.reason = reason;
    this.fields = fields;
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
    const obj = (data ?? {}) as { error?: string; reason?: string; fields?: Record<string, string> };
    throw new AdminApiError(
      res.status,
      obj.error ?? `Ошибка ${res.status}`,
      obj.reason,
      obj.fields,
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
  /** Как задано в админке; null — вместе с регистрацией на первый старт. */
  salesClosesAtCustom: string | null;
  /** Итоговая дата закрытия продажи абонемента. */
  salesClosesAt: string | null;
  salesOpen: boolean;
  firstEventDate: string | null;
};

export const updateSeason = (id: number, body: { price?: number; salesClosesAt?: string | null }) =>
  request<SeasonOption>(`/admin/seasons/${id}`, { method: 'PATCH', body });

export type AdminDistance = {
  id: number;
  label: string;
  slotsTotal: number;
  slotsTaken: number;
  slotsLeft: number;
  price: number;
  seasonPass: boolean;
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
  /** Дистанции; distance / slots* / price выше — сводка по ним. */
  distances: AdminDistance[];
  /** Первая карта трассы (путь относительно корня API) или null. */
  routeImageUrl: string | null;
  /** Все карты трасс по порядку. */
  routeMaps: AdminRouteMap[];
  /** Адрес страницы на сайте: /starty/<slug>. */
  slug: string | null;
  program: string | null;
  /** Время и место основной выдачи пакетов; null — «уточняются». */
  packetPickupInfo: string | null;
  /** Путь к PDF Положения относительно корня API, или null. */
  regulationsUrl: string | null;
  /** Когда закрывается регистрация — итоговая дата (заданная или за 7 дней до старта). */
  registrationClosesAt: string;
  /** Как задано в админке; null — по умолчанию. */
  registrationClosesAtCustom: string | null;
  createdAt: string;
  season: { id: number; title: string; year: number } | null;
  /** manual — добавленные вручную без оплаты, в paid не входят. */
  registrations: { total: number; pending: number; paid: number; manual: number; cancelled: number };
  resultsCount: number;
};

export type EventInput = {
  title: string;
  date: string; // ISO
  location: string;
  /** Дистанции целиком, в нужном порядке: с id — правка, без — новая. */
  distances: {
    id?: number;
    label: string;
    slotsTotal: number;
    price: number;
    seasonPass: boolean;
  }[];
  seasonId: number | null;
  /** ISO или null — по умолчанию за 7 дней до старта. */
  registrationClosesAt: string | null;
  /** null — сервер составит из названия и года. */
  slug: string | null;
  program: string | null;
  packetPickupInfo: string | null;
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

/** Карта трассы старта: путь к файлу относительно корня API и подпись. */
export type AdminRouteMap = { id: number; url: string; caption: string };

/** Ответ правок карт — старт (как в GET /events), из него нужны только карты. */
export type RouteMapsResult = { id: number; routeImageUrl: string | null; routeMaps: AdminRouteMap[] };

/**
 * Добавить карту трассы в конец списка. Идёт не через request(): тело здесь
 * multipart, а не JSON, и Content-Type должен поставить сам браузер — вместе с
 * boundary. Подпись — в адресе (?caption=).
 */
export async function addRouteMap(eventId: number, file: File, caption: string): Promise<RouteMapsResult> {
  const body = new FormData();
  body.append('file', file);

  let res: Response;
  try {
    res = await fetch(
      `${API_URL}/admin/events/${eventId}/route-maps?caption=${encodeURIComponent(caption)}`,
      { method: 'POST', credentials: 'same-origin', body },
    );
  } catch {
    throw new AdminApiError(0, 'Не удалось связаться с сервером');
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; reason?: string };
    // 413 без JSON — это nginx, а не наш обработчик: у него свой лимит на тело
    // запроса (client_max_body_size), и до бэкенда файл не дошёл.
    if (res.status === 413 && !obj.error) {
      throw new AdminApiError(
        413,
        'Файл отклонён веб-сервером как слишком большой. Уменьшите картинку или поднимите client_max_body_size в nginx.',
        'nginx_limit',
      );
    }
    throw new AdminApiError(res.status, obj.error ?? `Ошибка ${res.status}`, obj.reason);
  }
  return data as RouteMapsResult;
}

/** Порядок и подписи карт: все карты старта в нужном порядке. */
export const updateRouteMaps = (eventId: number, maps: { id: number; caption: string }[]) =>
  request<RouteMapsResult>(`/admin/events/${eventId}/route-maps`, { method: 'PUT', body: { maps } });

/** Убрать карту. */
export const deleteRouteMap = (eventId: number, mapId: number) =>
  request<RouteMapsResult>(`/admin/events/${eventId}/route-maps/${mapId}`, { method: 'DELETE' });

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

// ---------- Сообщение о новом старте ----------

export type AnnouncementRun = {
  running: boolean;
  total: number;
  done: number;
  sent: number;
  blocked: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type AnnouncementInfo = {
  /** Текст сообщения — HTML Telegram (собирает сервер). */
  text: string;
  button: { text: string };
  stats: { audience: number; pending: number; sent: number; blocked: number; failed: number };
  run: AnnouncementRun | null;
  /** Старт уже прошёл — рассылка недоступна. */
  started: boolean;
};

export const getAnnouncement = (eventId: number) =>
  request<AnnouncementInfo>(`/admin/events/${eventId}/announcement`);

export const startAnnouncement = (eventId: number) =>
  request<{ run: AnnouncementRun }>(`/admin/events/${eventId}/announcement`, { method: 'POST', body: {} });

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
  gender: 'MALE' | 'FEMALE' | null;
  /** yyyy-mm-dd или null. */
  birthDate: string | null;
  /** Полных лет на день этого старта; null — дата рождения неизвестна. */
  ageOnStart: number | null;
  telegramId: string | null;
  username: string | null;
  paymentStatus: PaymentStatus;
  /** Добавлен администратором без оплаты (партнёр, волонтёр). */
  manual: boolean;
  manualNote: string | null;
  distanceId: number | null;
  /** Название дистанции участника («5 км»). */
  distance: string | null;
  qrCode: string | null;
  seasonPassId: number | null;
  /** Оформлен возврат: запись CANCELLED, в списке — «Возврат». */
  refund: { at: string; percent: number | null; amount: number; confirmed: boolean } | null;
  registeredAt: string;
  result: { id: number; finishTime: number; place: number } | null;
};

export type ParticipantsResponse = {
  event: { id: number; title: string; date: string };
  distances: AdminDistance[];
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

/** Данные участника для правки и добавления вручную. */
export type ParticipantInput = {
  lastName: string;
  firstName: string;
  birthDate: string; // yyyy-mm-dd
  gender: 'MALE' | 'FEMALE';
  phone: string;
  email: string;
  distanceId: number;
  /** Только при добавлении: «партнёр», «волонтёр»… */
  note?: string;
};

export const updateParticipant = (registrationId: number, input: ParticipantInput) =>
  request<{ changed: boolean }>(`/admin/registrations/${registrationId}/participant`, { method: 'PATCH', body: input });

export const addParticipant = (eventId: number, input: ParticipantInput) =>
  request<{ registrationId: number }>(`/admin/events/${eventId}/participants`, { method: 'POST', body: input });

export type AuditEntry = {
  id: number;
  at: string;
  admin: string;
  action: 'participant.update' | 'participant.create' | 'registration.status' | 'registration.refund';
  registrationId: number | null;
  subject: string;
  changes: Record<string, [string | null, string | null]>;
};

// ---------- Возвраты (оферта, п. 5.1 и 5.3) ----------

export type RefundPercent = 100 | 50 | 0;

export type RefundStage = {
  registrationId: number;
  eventId: number;
  eventTitle: string;
  eventDate: string;
  base: number;
  refundable: boolean;
  note: string | null;
  suggested: RefundPercent;
  daysLeft: number;
  rule: string;
};

export type RefundPreview = {
  kind: 'single' | 'pass';
  subject: string;
  paymentId: number;
  paid: number;
  alreadyRefunded: number;
  providerRefunded: number;
  seasonPassId: number | null;
  stages: RefundStage[];
};

export const getRefundPreview = (registrationId: number) =>
  request<RefundPreview>(`/admin/registrations/${registrationId}/refund`);

export const applyRefund = (
  registrationId: number,
  body: { stages: { registrationId: number; percent: RefundPercent }[]; wholePass: boolean },
) =>
  request<{ total: number; stages: number; totalText: string }>(`/admin/registrations/${registrationId}/refund`, {
    method: 'POST',
    body,
  });

export const getAudit = (eventId: number) => request<AuditEntry[]>(`/admin/events/${eventId}/audit`);

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
