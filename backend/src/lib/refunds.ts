import type { Payment, Prisma, Registration } from '@prisma/client';
import { prisma } from '../prisma';
import { getInvoiceRefunds } from './apipay';
import { personLabel, writeAudit } from './audit';
import { distanceIdOf, releaseDistanceSlot } from './distances';
import { startOfDayInTz } from './notify';
import { sendMessage } from './telegramBot';
import { adminTelegramIds } from './telegramLogin';

/**
 * Возвраты стартового взноса (оферта, п. 5.1, 5.3).
 *
 * Решение пользователя 2026-10-18: деньги владелец возвращает сам — в кабинете
 * ApiPay или в Kaspi Pay. Админка только оформляет возврат: процент
 * (100 / 50 / 0), запись становится «Возврат» (в базе — CANCELLED +
 * refundedAt, поэтому место освобождается тем же путём, что и при отмене),
 * строка в refunds и запись в журнале изменений.
 *
 * Абонемент: возврат за один этап (цена абонемента / число стартов в нём)
 * или за все оставшиеся этапы — у каждого свой процент по его дате; тогда
 * и сам абонемент CANCELLED.
 *
 * Вебхук ApiPay invoice.refunded (syncApiPayRefunds): сумму возврата
 * записываем к платежу. Если возврат в админке уже оформлен на ту же сумму —
 * помечаем его подтверждённым; если нет — для старта оформляем сами
 * (процент — по сумме), для абонемента только пишем владельцу: какой этап,
 * из суммы не понять.
 */

const DAY_MS = 86_400_000;
export const REFUND_PERCENTS = [100, 50, 0] as const;
export type RefundPercent = (typeof REFUND_PERCENTS)[number];

/** Подсказка по таблице п. 5.1: за сколько дней до старта получен отказ. */
export function suggestedPercent(eventDate: Date, now: Date = new Date()): { percent: RefundPercent; daysLeft: number; rule: string } {
  const daysLeft = Math.round((startOfDayInTz(eventDate).getTime() - startOfDayInTz(now).getTime()) / DAY_MS);
  if (eventDate.getTime() <= now.getTime()) return { percent: 0, daysLeft, rule: 'старт уже прошёл (неявка) — без возврата' };
  if (daysLeft >= 30) return { percent: 100, daysLeft, rule: 'за 30 дней и более — 100%' };
  if (daysLeft >= 7) return { percent: 50, daysLeft, rule: 'за 7–29 дней — 50%' };
  return { percent: 0, daysLeft, rule: 'менее чем за 7 дней — без возврата' };
}

export const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/ /g, ' ')} ₸`;

export class RefundError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/** Оплаченный платёж за регистрацию или абонемент. */
function paidPaymentOf(db: Db, reg: Pick<Registration, 'id' | 'seasonPassId'>): Promise<Payment | null> {
  return db.payment.findFirst({
    where: reg.seasonPassId ? { seasonPassId: reg.seasonPassId, state: 'PAID' } : { registrationId: reg.id, state: 'PAID' },
    orderBy: { paidAt: 'desc' },
  });
}

/**
 * Сколько уже оформлено возвратов по платежу — по этапам. Возврат абонемента
 * из ApiPay без этапа (registrationId null) сюда не входит: это та же сумма,
 * которую владелец потом отметит по этапам в админке.
 */
async function refundedSoFar(db: Db, paymentId: number): Promise<number> {
  const agg = await db.refund.aggregate({ where: { paymentId, registrationId: { not: null } }, _sum: { amount: true } });
  return Number(agg._sum.amount ?? 0);
}

export type RefundStage = {
  registrationId: number;
  eventId: number;
  eventTitle: string;
  eventDate: Date;
  /** Цена этапа: старт — сумма платежа, абонемент — сумма / число стартов. */
  base: number;
  /** Можно оформить: оплачено и возврата ещё не было. */
  refundable: boolean;
  /** Почему нельзя — «возврат уже оформлен», «отменено». */
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
  /** Сколько вернул ApiPay по этому счёту (из вебхука). */
  providerRefunded: number;
  seasonPassId: number | null;
  /** Для старта — один этап; для абонемента — все старты абонемента. */
  stages: RefundStage[];
};

/** Что можно вернуть по регистрации: суммы и подсказки по оферте. */
export async function refundPreview(registrationId: number, now: Date = new Date()): Promise<RefundPreview> {
  const reg = await prisma.registration.findUnique({ where: { id: registrationId }, include: { user: true, event: true } });
  if (!reg) throw new RefundError('Регистрация не найдена', 404);
  if (reg.manual) throw new RefundError('Участник добавлен вручную без оплаты — возвращать нечего. Просто отмените запись');
  const payment = await paidPaymentOf(prisma, reg);
  if (!payment) {
    throw new RefundError('Оплаты через Kaspi по этой записи нет — возвращать нечего. Если нужно освободить место, отмените запись');
  }
  const paid = Math.round(Number(payment.amount));

  const regs = reg.seasonPassId
    ? await prisma.registration.findMany({
        where: { seasonPassId: reg.seasonPassId },
        include: { event: true },
        orderBy: { event: { date: 'asc' } },
      })
    : [{ ...reg }];
  const base = reg.seasonPassId ? Math.round(paid / regs.length) : paid;

  const stages = regs.map((r): RefundStage => {
    const s = suggestedPercent(r.event.date, now);
    const note = r.refundedAt ? 'возврат уже оформлен' : r.paymentStatus !== 'PAID' ? 'запись не оплачена или отменена' : null;
    return {
      registrationId: r.id,
      eventId: r.eventId,
      eventTitle: r.event.title,
      eventDate: r.event.date,
      base,
      refundable: note === null,
      note,
      suggested: s.percent,
      daysLeft: s.daysLeft,
      rule: s.rule,
    };
  });

  return {
    kind: reg.seasonPassId ? 'pass' : 'single',
    subject: personLabel(reg.user),
    paymentId: payment.id,
    paid,
    alreadyRefunded: await refundedSoFar(prisma, payment.id),
    providerRefunded: Math.round(Number(payment.refundedAmount)),
    seasonPassId: reg.seasonPassId,
    stages,
  };
}

/** Перевести этап в «Возврат»: CANCELLED + refundedAt, место — свободно. */
async function markStageRefunded(tx: Prisma.TransactionClient, reg: Registration): Promise<void> {
  const distanceId = await distanceIdOf(tx, reg);
  const res = await tx.registration.updateMany({
    where: { id: reg.id, paymentStatus: 'PAID', refundedAt: null },
    data: { paymentStatus: 'CANCELLED', refundedAt: new Date(), ...(distanceId ? { distanceId } : {}) },
  });
  if (res.count !== 1) throw new RefundError('Запись уже изменилась — обновите список');
  if (distanceId) await releaseDistanceSlot(tx, distanceId);
}

const auditValue = (percent: number | null, amount: number) => `${percent === null ? '' : `${percent}% · `}${money(amount)}`;

/**
 * Оформить возврат из админки. stages — какие этапы и под каким процентом;
 * для старта — ровно один (сама регистрация). wholePass — все оставшиеся
 * этапы абонемента, тогда абонемент CANCELLED.
 */
export async function applyAdminRefund(input: {
  registrationId: number;
  stages: { registrationId: number; percent: RefundPercent }[];
  wholePass: boolean;
  adminTelegramId: number;
}): Promise<{ total: number; stages: number }> {
  const preview = await refundPreview(input.registrationId);
  const byId = new Map(preview.stages.map((s) => [s.registrationId, s]));
  if (input.stages.length === 0) throw new RefundError('Выберите хотя бы один старт', 400);
  if (new Set(input.stages.map((s) => s.registrationId)).size !== input.stages.length) {
    throw new RefundError('Старт указан дважды', 400);
  }
  for (const s of input.stages) {
    const stage = byId.get(s.registrationId);
    if (!stage) throw new RefundError('Старт не из этого абонемента', 400);
    if (!stage.refundable) throw new RefundError(`«${stage.eventTitle}»: ${stage.note}`);
  }
  if (preview.kind === 'single' && (input.wholePass || input.stages.length !== 1)) {
    throw new RefundError('Это регистрация на один старт', 400);
  }
  if (preview.kind === 'pass' && input.wholePass) {
    const left = preview.stages.filter((s) => s.refundable).map((s) => s.registrationId);
    const chosen = new Set(input.stages.map((s) => s.registrationId));
    if (left.some((id) => !chosen.has(id))) throw new RefundError('Для возврата за весь абонемент укажите все оставшиеся старты', 400);
  }
  if (preview.kind === 'pass' && !input.wholePass && input.stages.length !== 1) {
    throw new RefundError('По одному этапу — один старт; за несколько — «весь абонемент»', 400);
  }

  const rows = input.stages.map((s) => {
    const stage = byId.get(s.registrationId)!;
    return { stage, percent: s.percent, amount: Math.round((stage.base * s.percent) / 100) };
  });
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  await prisma.$transaction(async (tx) => {
    // Сумма возвратов не больше оплаченного — проверяем внутри транзакции.
    if ((await refundedSoFar(tx, preview.paymentId)) + total > preview.paid) {
      throw new RefundError('Сумма возвратов больше, чем оплачено');
    }
    for (const { stage, percent, amount } of rows) {
      const reg = await tx.registration.findUniqueOrThrow({ where: { id: stage.registrationId }, include: { user: true } });
      await markStageRefunded(tx, reg);
      await tx.refund.create({
        data: {
          userId: reg.userId,
          paymentId: preview.paymentId,
          registrationId: reg.id,
          seasonPassId: preview.seasonPassId,
          eventId: reg.eventId,
          percent,
          amount,
          source: 'ADMIN',
          adminTelegramId: BigInt(input.adminTelegramId),
        },
      });
      await writeAudit(tx, {
        adminTelegramId: input.adminTelegramId,
        action: 'registration.refund',
        eventId: reg.eventId,
        registrationId: reg.id,
        userId: reg.userId,
        subject: personLabel(reg.user),
        changes: {
          paymentStatus: ['PAID', 'REFUNDED'],
          refund: [null, auditValue(percent, amount)],
          ...(preview.kind === 'pass' ? { pass: [null, input.wholePass ? 'весь абонемент' : 'один этап'] } : {}),
        },
      });
    }
    if (preview.kind === 'pass' && input.wholePass && preview.seasonPassId) {
      await tx.seasonPass.update({
        where: { id: preview.seasonPassId },
        data: { paymentStatus: 'CANCELLED', refundedAt: new Date() },
      });
    }
  });
  return { total, stages: rows.length };
}

// ---------- Вебхук ApiPay invoice.refunded ----------

type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

async function tellAdmins(text: string, log: Logger): Promise<void> {
  for (const id of adminTelegramIds()) {
    const res = await sendMessage(String(id), text);
    if (!res.ok) log.warn({ telegramId: id, error: res.error }, 'Не удалось сообщить о возврате');
  }
}

/**
 * Свести возвраты счёта с нашими. Список берём GET /invoices/{id}/refunds,
 * а не из тела вебхука. Повторный вызов безопасен: возврат ApiPay учитывается
 * один раз (refunds.provider_refund_id уникален).
 */
export async function syncApiPayRefunds(invoiceId: number, log: Logger): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { providerInvoiceId: invoiceId } });
  if (!payment) {
    log.warn({ invoiceId }, 'Возврат ApiPay по незнакомому счёту');
    return;
  }
  const data = await getInvoiceRefunds(invoiceId);
  const totalRefunded = Number(data.invoice?.total_refunded ?? 0);
  await prisma.payment.update({ where: { id: payment.id }, data: { refundedAmount: totalRefunded } });

  const user = await prisma.user.findUnique({ where: { id: payment.userId } });
  const who = user ? personLabel(user) : `участник #${payment.userId}`;

  for (const r of data.refunds ?? []) {
    if (r.status === 'failed') {
      const known = await prisma.refund.findUnique({ where: { providerRefundId: r.id } });
      if (!known) {
        // Отмечаем «увидели» без суммы, чтобы не писать владельцу на каждый повтор вебхука.
        await prisma.refund.create({
          data: { userId: payment.userId, paymentId: payment.id, amount: 0, source: 'APIPAY', providerRefundId: r.id, percent: null },
        });
        await tellAdmins(
          `⚠️ Возврат ${money(Number(r.amount))} (${who}) в ApiPay не прошёл${r.error_code ? `: ${r.error_code}` : ''}. Проведите его вручную в Kaspi Pay.`,
          log,
        );
      }
      continue;
    }
    if (r.status !== 'completed') continue;
    if (await prisma.refund.findUnique({ where: { providerRefundId: r.id } })) continue;

    const amount = Math.round(Number(r.amount));
    // Возврат уже оформлен в админке на ту же сумму — подтверждаем его. Для
    // «всего абонемента» в админке строк несколько (по этапу), а в ApiPay
    // один возврат на их сумму — тогда подтверждаем все неподтверждённые.
    const pending = await prisma.refund.findMany({
      where: { paymentId: payment.id, source: 'ADMIN', confirmedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const one = pending.find((p) => Math.round(Number(p.amount)) === amount);
    const all = pending.reduce((sum, p) => sum + Math.round(Number(p.amount)), 0) === amount ? pending : [];
    const confirm = one ? [one] : all;
    if (confirm.length > 0) {
      await prisma.$transaction([
        prisma.refund.update({ where: { id: confirm[0].id }, data: { providerRefundId: r.id, confirmedAt: new Date() } }),
        prisma.refund.updateMany({ where: { id: { in: confirm.slice(1).map((p) => p.id) } }, data: { confirmedAt: new Date() } }),
      ]);
      log.info({ paymentId: payment.id, refundId: r.id }, 'Возврат ApiPay подтвердил оформленный в админке');
      continue;
    }

    // В админке не оформляли. Старт — оформляем сами; абонемент — пишем владельцу.
    const paid = Math.round(Number(payment.amount));
    if (payment.purpose === 'REGISTRATION' && payment.registrationId) {
      const percent = paid > 0 ? Math.round((amount / paid) * 100) : null;
      const reg = await prisma.registration.findUnique({ where: { id: payment.registrationId }, include: { user: true, event: true } });
      let marked = false;
      await prisma.$transaction(async (tx) => {
        if (reg && reg.paymentStatus === 'PAID' && !reg.refundedAt) {
          await markStageRefunded(tx, reg);
          marked = true;
        }
        await tx.refund.create({
          data: {
            userId: payment.userId,
            paymentId: payment.id,
            registrationId: payment.registrationId,
            eventId: reg?.eventId ?? null,
            percent,
            amount,
            source: 'APIPAY',
            providerRefundId: r.id,
            confirmedAt: new Date(),
          },
        });
        if (reg) {
          await writeAudit(tx, {
            adminTelegramId: 0, // 0 — ApiPay, не человек
            action: 'registration.refund',
            eventId: reg.eventId,
            registrationId: reg.id,
            userId: reg.userId,
            subject: personLabel(reg.user),
            changes: {
              ...(marked ? { paymentStatus: ['PAID', 'REFUNDED'] as [string, string] } : {}),
              refund: [null, `${auditValue(percent, amount)} (вебхук ApiPay)`],
            },
          });
        }
      });
      await tellAdmins(
        `↩️ ApiPay: возврат ${money(amount)} — ${who}${reg ? `, «${reg.event.title}»` : ''}.` +
          (marked ? ' В админке запись переведена в «Возврат», место освобождено.' : ' Запись уже была отменена — отметили только сумму.'),
        log,
      );
    } else {
      await prisma.refund.create({
        data: {
          userId: payment.userId,
          paymentId: payment.id,
          seasonPassId: payment.seasonPassId,
          percent: null,
          amount,
          source: 'APIPAY',
          providerRefundId: r.id,
          confirmedAt: new Date(),
        },
      });
      await tellAdmins(
        `↩️ ApiPay: возврат ${money(amount)} по абонементу — ${who}. Отметьте в админке, за какие этапы («Оформить возврат»): сам этап по сумме не определить.`,
        log,
      );
    }
    log.info({ paymentId: payment.id, refundId: r.id, amount }, 'Возврат ApiPay учтён');
  }
}
