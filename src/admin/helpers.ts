const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Almaty',
});

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Almaty',
});

export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

/** ISO -> значение для <input type="datetime-local"> в локальной зоне браузера. */
export function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * «22:14» или «1:05:30» -> секунды. null, если разобрать не удалось.
 * Бэкенд принимает только секунды, разбор ввода — здесь.
 */
export function parseTimeToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;

  const nums = parts.map(Number);
  const [h, m, s] = parts.length === 3 ? nums : [0, nums[0], nums[1]];

  if (m > 59 || s > 59) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 && total <= 24 * 3600 ? total : null;
}

/** Секунды -> «22:14», а от часа и больше — «1:05:30». */
export function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fullName(lastName: string | null, firstName: string): string {
  return [lastName, firstName].filter(Boolean).join(' ') || '—';
}

export const priceFmt = new Intl.NumberFormat('ru-RU');

export const PAYMENT_LABEL: Record<string, string> = {
  PENDING: 'Ожидает',
  PAID: 'Оплачено',
  CANCELLED: 'Отменено',
};
