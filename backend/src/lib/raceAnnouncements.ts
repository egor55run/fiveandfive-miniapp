import type { Event, EventDistance } from '@prisma/client';
import { prisma } from '../prisma';
import { appUrl } from './openingSubscribers';
import { escapeHtml, sendMessage, type InlineButton } from './telegramBot';

/**
 * Рассылка «новый старт»: всем, кто писал боту и не отписался (/stop), — одно
 * сообщение на старт. Кому уже дошло или кто заблокировал бота — повторно не
 * пишем; не дошедшим из-за сбоя (FAILED) — повторит следующий запуск.
 *
 * Отправка — в фоне, по одной рассылке на старт за раз, с паузой между
 * сообщениями (лимит Telegram — около 30 в секунду).
 */

const PAUSE_MS = 50;
const TZ = 'Asia/Almaty';

type EventWithDistances = Event & { distances: EventDistance[] };

/** Сам текст — HTML Telegram (как в остальных сообщениях бота). */
export function announcementText(event: EventWithDistances): string {
  const date = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
    .format(event.date)
    .replace(/^./, (c) => c.toUpperCase());
  const time = new Intl.DateTimeFormat('ru-RU', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(event.date);
  const distances = event.distances.length > 0 ? event.distances.map((d) => d.label).join(' · ') : event.distance;
  return [
    '🏁 <b>Новый старт 5&amp;5!</b>',
    '',
    `<b>${escapeHtml(event.title)}</b>`,
    `📅 ${date}, ${time} по Астане`,
    `📍 ${escapeHtml(event.location)}`,
    `📏 ${escapeHtml(distances)}`,
    '',
    'Подробности и регистрация — в приложении.',
  ].join('\n');
}

/** Кнопка «Открыть» — Mini App сразу на этом старте. */
export function announcementButton(event: Event): InlineButton {
  const url = event.slug ? `${appUrl()}?race=${encodeURIComponent(event.slug)}` : appUrl();
  return { text: 'Открыть', web_app: { url } };
}

/** Кому писать: писали боту, не отписались, не заблокировали. */
const AUDIENCE = { stoppedAt: null, blockedAt: null } as const;

export type AnnouncementStats = {
  /** Сколько сейчас можно уведомить вообще (писали боту и не отписались). */
  audience: number;
  /** Из них ещё не получили сообщение об этом старте. */
  pending: number;
  sent: number;
  blocked: number;
  failed: number;
};

export async function announcementStats(eventId: number): Promise<AnnouncementStats> {
  const [audience, done, grouped] = await Promise.all([
    prisma.botContact.count({ where: AUDIENCE }),
    prisma.raceAnnouncement.findMany({
      where: { eventId, status: { in: ['SENT', 'BLOCKED'] } },
      select: { telegramId: true },
    }),
    prisma.raceAnnouncement.groupBy({ by: ['status'], where: { eventId }, _count: { _all: true } }),
  ]);
  const doneIds = done.map((d) => d.telegramId);
  const pending = await prisma.botContact.count({
    where: { ...AUDIENCE, ...(doneIds.length ? { telegramId: { notIn: doneIds } } : {}) },
  });
  const by = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
  return { audience, pending, sent: by('SENT'), blocked: by('BLOCKED'), failed: by('FAILED') };
}

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

const runs = new Map<number, AnnouncementRun>();

export const announcementRun = (eventId: number): AnnouncementRun | null => {
  const run = runs.get(eventId);
  return run ? { ...run } : null;
};

type Logger = { info: (o: object, m: string) => void; error: (o: object, m: string) => void };

/** Запустить рассылку о старте. false — по этому старту она уже идёт. */
export function startAnnouncement(event: EventWithDistances, log: Logger): boolean {
  if (runs.get(event.id)?.running) return false;
  const run: AnnouncementRun = {
    running: true,
    total: 0,
    done: 0,
    sent: 0,
    blocked: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  runs.set(event.id, run);
  const text = announcementText(event);
  const button = announcementButton(event);

  void (async () => {
    try {
      const done = await prisma.raceAnnouncement.findMany({
        where: { eventId: event.id, status: { in: ['SENT', 'BLOCKED'] } },
        select: { telegramId: true },
      });
      const doneIds = done.map((d) => d.telegramId);
      const contacts = await prisma.botContact.findMany({
        where: { ...AUDIENCE, ...(doneIds.length ? { telegramId: { notIn: doneIds } } : {}) },
        orderBy: { id: 'asc' },
      });
      run.total = contacts.length;
      log.info({ eventId: event.id, total: run.total }, 'Рассылка «новый старт»: старт');

      for (const [i, c] of contacts.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
        // Человек мог нажать /stop, пока шла рассылка.
        const fresh = await prisma.botContact.findUnique({ where: { id: c.id } });
        if (!fresh || fresh.stoppedAt || fresh.blockedAt) {
          run.done++;
          continue;
        }
        const outcome = await sendMessage(c.telegramId.toString(), text, [[button]]);
        const status = outcome.ok ? 'SENT' : outcome.blocked ? 'BLOCKED' : 'FAILED';
        const error = outcome.ok ? null : outcome.error.slice(0, 300);
        await prisma.raceAnnouncement.upsert({
          where: { eventId_telegramId: { eventId: event.id, telegramId: c.telegramId } },
          create: { eventId: event.id, telegramId: c.telegramId, status, error },
          update: { status, error, sentAt: new Date() },
        });
        if (status === 'BLOCKED') {
          await prisma.botContact.update({ where: { id: c.id }, data: { blockedAt: new Date() } });
        }
        run.done++;
        if (status === 'SENT') run.sent++;
        else if (status === 'BLOCKED') run.blocked++;
        else run.failed++;
      }
      log.info({ eventId: event.id, ...run }, 'Рассылка «новый старт»: готово');
    } catch (err) {
      log.error({ eventId: event.id, err: String(err) }, 'Рассылка «новый старт»: сбой');
    } finally {
      run.running = false;
      run.finishedAt = new Date().toISOString();
    }
  })();
  return true;
}

/** Запомнить, что человек писал боту (и снять «заблокировал» — раз пишет, не блокирует). */
export async function touchBotContact(
  user: { id: number; first_name?: string; username?: string },
  opts: { start?: boolean } = {},
): Promise<void> {
  const telegramId = BigInt(user.id);
  const now = new Date();
  await prisma.botContact.upsert({
    where: { telegramId },
    create: { telegramId, firstName: user.first_name ?? null, username: user.username ?? null },
    update: {
      firstName: user.first_name ?? undefined,
      username: user.username ?? undefined,
      lastSeenAt: now,
      blockedAt: null,
      // /start — снова подписан на рассылки бота.
      ...(opts.start ? { stoppedAt: null } : {}),
    },
  });
}

/** /stop: больше не писать этому человеку рассылок. */
export async function stopBotContact(telegramId: number): Promise<void> {
  await prisma.botContact.updateMany({
    where: { telegramId: BigInt(telegramId) },
    data: { stoppedAt: new Date() },
  });
}
