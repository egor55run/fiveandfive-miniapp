import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

/**
 * Настройки проекта, которые организатор меняет в админке (раздел
 * «Настройки», 2026-11-10) вместо .env и сборки: показывать ли цены, открыта ли
 * регистрация, лимиты счетов и писем, частые вопросы. Хранятся в app_settings,
 * в памяти — копия: читается синхронно на каждом запросе, обновляется при
 * сохранении из админки и раз в минуту (на случай второго процесса, например
 * задачи напоминаний).
 */

export type FaqBlock = string | { list: string[] };
export type FaqItem = { id: string; q: string; a: FaqBlock[] };

export type Settings = {
  /** Цены видны на сайте, в Mini App, в боте и в разметке schema.org. */
  pricesPublic: boolean;
  /** Регистрация открыта (при подключённой оплате — см. registrationWindow). */
  registrationOpen: boolean;
  /** Когда регистрацию открыли последний раз — validFrom в разметке. */
  registrationOpenedAt: string | null;
  /** Счетов Kaspi в день и порог предупреждения (тариф ApiPay). */
  invoiceDailyLimit: number;
  invoiceDailyWarn: number;
  /** Писем в сутки (тариф Brevo). */
  emailDailyLimit: number;
  /** Частые вопросы (сайт /voprosy и бот). null — исходные из content/faq.json. */
  faq: FaqItem[] | null;
};

const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Значения по умолчанию — прежние переменные .env, пока в админке ничего не сохраняли. */
function defaults(): Settings {
  return {
    pricesPublic: process.env.PRICES_PUBLIC?.trim().toLowerCase() === 'true',
    registrationOpen: process.env.REGISTRATION_OPEN?.trim().toLowerCase() === 'true',
    registrationOpenedAt: null,
    invoiceDailyLimit: envInt('APIPAY_DAILY_LIMIT', 100),
    invoiceDailyWarn: envInt('APIPAY_DAILY_WARN', 80),
    emailDailyLimit: envInt('EMAIL_DAILY_LIMIT', 290),
    faq: null,
  };
}

let current: Settings = defaults();

export const settings = (): Settings => current;

export async function loadSettings(): Promise<Settings> {
  const rows = await prisma.appSetting.findMany();
  const next = defaults() as Record<string, unknown>;
  for (const r of rows) if (r.key in next) next[r.key] = r.value;
  current = next as Settings;
  return current;
}

/** Сохранить изменённые поля. Возвращает новые настройки. */
export async function saveSettings(patch: Partial<Settings>, adminTelegramId: number): Promise<Settings> {
  const before = current;
  const data: Partial<Settings> = { ...patch };
  // Включили регистрацию — запоминаем когда: это дата начала продаж в разметке.
  if (patch.registrationOpen === true && !before.registrationOpen) data.registrationOpenedAt = new Date().toISOString();
  await prisma.$transaction(
    Object.entries(data).map(([key, value]) =>
      prisma.appSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedBy: BigInt(adminTelegramId) },
        update: { value: value as Prisma.InputJsonValue, updatedBy: BigInt(adminTelegramId) },
      }),
    ),
  );
  return loadSettings();
}

let timer: NodeJS.Timeout | null = null;

/** Загрузить при старте и подтягивать раз в минуту. */
export async function startSettings(log: { error: (o: object, m: string) => void }): Promise<void> {
  await loadSettings();
  timer = setInterval(() => {
    loadSettings().catch((err) => log.error({ err: String(err) }, 'Настройки: не удалось перечитать'));
  }, 60_000);
  timer.unref();
}
