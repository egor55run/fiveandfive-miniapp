import { prisma } from '../prisma';
import { escapeHtml, sendMessage } from './telegramBot';

/**
 * Подписка «Узнать об открытии регистрации» (этап 2 сайта, решение пользователя
 * 2026-10-09).
 *
 * Подписаться можно тремя путями: кнопка на сайте ведёт в бота с /start
 * notify-<slug>, кнопка «Сообщить об открытии» в самом боте, кнопка в Mini App
 * на экране «Регистрация скоро откроется». Заодно это снимает ограничение
 * «бот не пишет первым»: подписчик сам начал диалог.
 *
 * Рассылку запускает администратор вручную, когда открыл регистрацию. Не
 * автоматически: регистрация открывается правкой .env, и в этот момент легко
 * разослать раньше времени.
 */

const APP_URL = (process.env.APP_URL ?? 'https://fiveandfive.kz').replace(/\/+$/, '');
const PAUSE_MS = 50; // ~20 сообщений в секунду: ниже лимита Telegram (около 30/с)

export const appUrl = () => `${APP_URL}/app`;

type TgUser = { id: number; first_name?: string; username?: string };

/** Подписать (или вернуть отписавшегося). Повторная подписка ничего не ломает. */
export async function subscribe(user: TgUser, source: string): Promise<void> {
  const telegramId = BigInt(user.id);
  await prisma.openingSubscriber.upsert({
    where: { telegramId },
    create: {
      telegramId,
      firstName: user.first_name ?? null,
      username: user.username ?? null,
      source,
    },
    update: {
      firstName: user.first_name ?? null,
      username: user.username ?? null,
      unsubscribedAt: null,
    },
  });
}

/** Отписать. false — подписки и не было. */
export async function unsubscribe(telegramId: number): Promise<boolean> {
  const res = await prisma.openingSubscriber.updateMany({
    where: { telegramId: BigInt(telegramId), unsubscribedAt: null },
    data: { unsubscribedAt: new Date() },
  });
  return res.count > 0;
}

export type SubscriberStats = {
  /** Подписаны сейчас. */
  active: number;
  /** Из них ещё не получили сообщение об открытии. */
  pending: number;
  sent: number;
  blocked: number;
  failed: number;
  unsubscribed: number;
};

export async function subscriberStats(): Promise<SubscriberStats> {
  const [active, pending, sent, blocked, failed, unsubscribed] = await Promise.all([
    prisma.openingSubscriber.count({ where: { unsubscribedAt: null } }),
    prisma.openingSubscriber.count({ where: { unsubscribedAt: null, notifiedAt: null } }),
    prisma.openingSubscriber.count({ where: { notifyStatus: 'SENT' } }),
    prisma.openingSubscriber.count({ where: { notifyStatus: 'BLOCKED' } }),
    prisma.openingSubscriber.count({ where: { notifyStatus: 'FAILED' } }),
    prisma.openingSubscriber.count({ where: { unsubscribedAt: { not: null } } }),
  ]);
  return { active, pending, sent, blocked, failed, unsubscribed };
}

/** Текст по умолчанию — администратор может поправить его перед отправкой. */
export const DEFAULT_OPENING_TEXT = [
  'Регистрация на забеги 5&5 открыта!',
  '',
  'Сезон 2027 — пять забегов по 5 км в парках Астаны. Количество мест на каждом старте ограничено.',
  '',
  'Выбрать старт и записаться — в приложении, кнопка ниже.',
].join('\n');

// ---------- Рассылка: одна за раз, в фоне ----------

export type BroadcastState = {
  running: boolean;
  total: number;
  done: number;
  sent: number;
  blocked: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
};

const state: BroadcastState = {
  running: false,
  total: 0,
  done: 0,
  sent: 0,
  blocked: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
};

export const broadcastState = (): BroadcastState => ({ ...state });

type Logger = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

/**
 * Запустить рассылку всем подписанным, кто её ещё не получил. Текст —
 * обычный, без разметки (экранируется). Возвращает false, если рассылка уже идёт.
 */
export function startBroadcast(text: string, log: Logger): boolean {
  if (state.running) return false;
  Object.assign(state, {
    running: true,
    total: 0,
    done: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  void (async () => {
    try {
      const subscribers = await prisma.openingSubscriber.findMany({
        where: { unsubscribedAt: null, notifiedAt: null },
        orderBy: { id: 'asc' },
      });
      state.total = subscribers.length;
      log.info({ total: state.total }, 'Рассылка «регистрация открыта»: старт');

      for (const [i, sub] of subscribers.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
        const outcome = await sendMessage(sub.telegramId.toString(), escapeHtml(text), {
          text: 'Открыть приложение',
          url: appUrl(),
        });
        const status = outcome.ok ? 'SENT' : outcome.blocked ? 'BLOCKED' : 'FAILED';
        await prisma.openingSubscriber.update({
          where: { id: sub.id },
          data: {
            // Заблокировавшим бота повторять бесполезно — отмечаем как отправленное;
            // сбой сети или Telegram — оставляем на повторную рассылку.
            notifiedAt: status === 'FAILED' ? null : new Date(),
            notifyStatus: status,
            notifyError: outcome.ok ? null : outcome.error.slice(0, 300),
          },
        });
        state.done++;
        if (status === 'SENT') state.sent++;
        else if (status === 'BLOCKED') state.blocked++;
        else state.failed++;
      }
      log.info({ ...state }, 'Рассылка «регистрация открыта»: готово');
    } catch (err) {
      log.error({ err: String(err) }, 'Рассылка «регистрация открыта»: сбой');
    } finally {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    }
  })();
  return true;
}
