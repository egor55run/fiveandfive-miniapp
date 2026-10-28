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

export const updateSeason = (
  id: number,
  body: { price?: number; salesClosesAt?: string | null },
) =>
  request<SeasonOption>(`/admin/seasons/${id}`, { method: 'PATCH', body });

export type AdminDistance = {
  id: number;
  label: string;
  slotsTotal: number;
  slotsTaken: number;
  slotsLeft: number;
  price: number;
  seasonPass: boolean;
  /** Дистанция из справочника (3 км, 5 км…). */
  catalogId: number;
  /** Диапазон стартовых номеров; null — номера не выдаются. */
  bibFrom: number | null;
  bibTo: number | null;
};

/** Выдача пакетов: место, адрес, даты и часы. */
export type PickupInfo = {
  place: string | null;
  address: string | null;
  comment: string | null;
  slots: { startsAt: string; endsAt: string }[];
  configured: boolean;
};

export type EventTheme = { bgUrl: string | null; logoUrl: string | null; accent: string | null };

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
  /** Комментарий к выдаче пакетов (раньше — «время и место»). */
  packetPickupInfo: string | null;
  pickup: PickupInfo;
  theme: EventTheme | null;
  /** Резерв номеров: автоматически не выдаются. */
  bibReserves: { bibFrom: number; bibTo: number; note: string | null }[];
  /** Что не заполнено — показывается в списке стартов. */
  warnings: string[];
  paidWithoutBib: number;
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
    bibFrom: number | null;
    bibTo: number | null;
  }[];
  seasonId: number | null;
  /** ISO или null — по умолчанию за 7 дней до старта. */
  registrationClosesAt: string | null;
  /** null — сервер составит из названия и года. */
  slug: string | null;
  program: string | null;
  packetPickupInfo: string | null;
  pickupPlace: string | null;
  pickupAddress: string | null;
  pickupSlots: { startsAt: string; endsAt: string }[];
  bibReserves: { bibFrom: number; bibTo: number; note: string | null }[];
  /** Цвет меняет ThemeEditor; форма старта его не трогает. */
  themeAccent?: string | null;
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

/** Фон или логотип оформления старта (JPG/PNG/WebP до 5 МБ). */
export async function uploadTheme(eventId: number, kind: 'bg' | 'logo', file: File): Promise<AdminEvent> {
  const body = new FormData();
  body.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin/events/${eventId}/theme/${kind}`, { method: 'POST', credentials: 'same-origin', body });
  } catch {
    throw new AdminApiError(0, 'Не удалось связаться с сервером');
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const obj = (data ?? {}) as { error?: string; reason?: string };
    throw new AdminApiError(res.status, obj.error ?? `Ошибка ${res.status}`, obj.reason);
  }
  return data as AdminEvent;
}

export const deleteTheme = (eventId: number, kind: 'bg' | 'logo') =>
  request<AdminEvent>(`/admin/events/${eventId}/theme/${kind}`, { method: 'DELETE' });

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
  /** Стартовый номер; у абонемента — общий на сезон. */
  bibNumber: number | null;
  /** Цена, скидка, итог; pass — цена абонемента целиком. */
  price: { base: number; discount: number; total: number; promoCode: string | null; pass: boolean } | null;
  /** Оформлен возврат: запись CANCELLED, в списке — «Возврат». */
  refund: { at: string; percent: number | null; amount: number; confirmed: boolean } | null;
  registeredAt: string;
  result: { id: number; finishTime: number | null; place: number | null; status: ResultStatus } | null;
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
    bibNumber: number | null;
    /** 'kept' — выдача пакетов началась, номер остался за записью. */
    bibNote: 'released' | 'kept' | 'none' | number | null;
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
  action:
    | 'participant.update'
    | 'participant.create'
    | 'registration.status'
    | 'registration.refund'
    | 'registration.bib'
    | 'result.update'
    | 'result.import'
    | 'result.publish'
    | 'user.merge';
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
  /** Выдача пакетов на этом старте уже началась: по оферте возврата нет, номер останется. */
  pickupStarted: boolean;
  bibNumber: number | null;
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

/** Ручная смена номера — на этом старте. */
export const setBib = (registrationId: number, bib: number | null) =>
  request<{ bibNumber: number | null; registrations: number }>(`/admin/registrations/${registrationId}/bib`, {
    method: 'PATCH',
    body: { bib },
  });

/** Выдать номера оплаченным без номера (после того как задали диапазоны). */
export const assignBibs = (eventId: number) =>
  request<{ assigned: number; missing: number }>(`/admin/events/${eventId}/assign-bibs`, { method: 'POST', body: {} });

// ---------- Промокоды ----------

export type PromoRedemption = {
  id: number;
  at: string;
  who: string;
  username: string | null;
  telegramId: string | null;
  target: string;
  base: number;
  discount: number;
  total: number;
  status: 'HELD' | 'USED' | 'RELEASED';
};

export type PromoCode = {
  id: number;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  maxUses: number | null;
  validFrom: string | null;
  validUntil: string | null;
  eventId: number | null;
  event: { id: number; title: string; date: string } | null;
  active: boolean;
  note: string | null;
  createdAt: string;
  used: number;
  redemptions: PromoRedemption[];
};

export type PromoInput = Pick<PromoCode, 'code' | 'kind' | 'value' | 'maxUses' | 'validFrom' | 'validUntil' | 'eventId' | 'active' | 'note'>;

export const getPromoCodes = () => request<PromoCode[]>('/admin/promo-codes');
export const createPromoCode = (input: PromoInput) =>
  request<{ id: number }>('/admin/promo-codes', { method: 'POST', body: input });
export const updatePromoCode = (id: number, input: PromoInput) =>
  request<{ id: number }>(`/admin/promo-codes/${id}`, { method: 'PATCH', body: input });

export const getAudit = (eventId: number) => request<AuditEntry[]>(`/admin/events/${eventId}/audit`);

// ---------- Результаты и рейтинг ----------

export type ResultStatus = 'FINISHED' | 'DNF' | 'DNS' | 'DSQ';

export type ResultRow = {
  id: number;
  userId: number;
  lastName: string | null;
  firstName: string;
  username: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  bib: number | null;
  status: ResultStatus;
  /** Время от выстрела, секунды; null — не финишировал. */
  finishTime: number | null;
  place: number | null;
  /** Место среди своего пола — зачёт рейтинга. */
  genderPlace: number | null;
  points: number;
  recordedAt: string;
};

export type ResultsEventInfo = {
  id: number;
  title: string;
  date: string;
  distance: string;
  resultsPublishedAt: string | null;
  /** До какого момента окно протестов; null — не опубликовано. */
  protestUntil: string | null;
};

export type ResultsResponse = { event: ResultsEventInfo; results: ResultRow[] };

export const getResults = (eventId: number) => request<ResultsResponse>(`/admin/events/${eventId}/results`);

/** Место и баллы считает сервер. force — правка после окна протестов. */
export const putResult = (
  eventId: number,
  body: { userId: number; status: ResultStatus; finishTime: number | null; force?: boolean },
) => request<ResultsResponse>(`/admin/events/${eventId}/results`, { method: 'PUT', body });

export const deleteResult = (resultId: number, force = false) =>
  request<ResultsResponse>(`/admin/results/${resultId}${force ? '?force=1' : ''}`, { method: 'DELETE' });

export type ImportPreview = {
  matched: { bib: number; name: string; status: ResultStatus; finishTime: number | null }[];
  unknown: number[];
  duplicates: number[];
  missing: { bib: number | null; name: string }[];
  warnings: string[];
};

/** Файл хронометража: dryRun — только предпросмотр. */
export const importResults = (eventId: number, body: { csv: string; dryRun: boolean; missingAsDns: boolean; force?: boolean }) =>
  request<{ preview: ImportPreview; results?: ResultRow[]; event?: ResultsEventInfo }>(`/admin/events/${eventId}/results/import`, {
    method: 'POST',
    body,
  });

export const publishResults = (eventId: number) =>
  request<{ event: ResultsEventInfo }>(`/admin/events/${eventId}/results/publish`, { method: 'POST', body: {} });
export const unpublishResults = (eventId: number) =>
  request<{ event: ResultsEventInfo }>(`/admin/events/${eventId}/results/unpublish`, { method: 'POST', body: {} });

// ---------- Двойники ----------

export type DuplicateCandidate = {
  userId: number;
  name: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  telegram: boolean;
  username: string | null;
  events: string[];
};

export const getDuplicates = (userId: number) => request<DuplicateCandidate[]>(`/admin/users/${userId}/duplicates`);
export const mergeUsers = (intoUserId: number, fromUserId: number) =>
  request<{ moved: Record<string, number> }>('/admin/users/merge', { method: 'POST', body: { intoUserId, fromUserId } });

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
