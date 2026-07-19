// Базовый URL бэкенда. Переопределяется через VITE_API_URL (.env),
// с запасным значением для локальной разработки.
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

export type UserDto = {
  id: number;
  telegramId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  phone: string;
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

export async function getEvents(): Promise<EventDto[]> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/events`);
  } catch {
    throw new ApiError(0, 'Не удалось связаться с сервером');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Не удалось загрузить старты (${res.status})`);
  }
  return res.json();
}

export async function createRegistration(
  payload: RegistrationPayload,
): Promise<RegistrationResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ApiError(0, 'Не удалось связаться с сервером');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && (data.error as string)) || `Ошибка (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as RegistrationResult;
}
