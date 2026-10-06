import type { Payment, PaymentState, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import {
  ApiPayError,
  apiPayConfigured,
  cancelInvoice,
  createInvoice,
  getInvoice,
  type ApiPayInvoice,
} from './apipay';
import { deliver, registrationText, seasonPassText } from './notify';

/**
 * Оплата регистраций через Kaspi (ApiPay).
 *
 * Жизненный цикл:
 *   1. Роут занимает место (регистрация PENDING) и вызывает startPayment.
 *   2. ApiPay выставляет счёт на номер участника — он приходит в приложение Kaspi.
 *   3. Об оплате узнаём тремя путями, и все сходятся в applyInvoice/markPaid:
 *      вебхук ApiPay, опрос из приложения (GET /payments/:id) и фоновая сверка.
 *   4. Оплачено → регистрация PAID и сообщение в Telegram.
 *      Не оплачено за PAYMENT_TTL_MINUTES → счёт отменяем, место освобождаем.
 *
 * Все переходы условные (updateMany с проверкой текущего статуса), поэтому
 * вебхук и фоновая сверка, пришедшие одновременно, не задвоят ни оплату,
 * ни освобождение места.
 */

type Logger = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

const ACTIVE: PaymentState[] = ['CREATED', 'PENDING'];

/** Сколько держим место за неоплаченной регистрацией. */
export function paymentTtlMs(): number {
  const minutes = Number(process.env.PAYMENT_TTL_MINUTES ?? 30);
  return (Number.isFinite(minutes) && minutes >= 5 ? minutes : 30) * 60_000;
}

export { apiPayConfigured };

/** Статус ApiPay → наш. */
export function mapProviderStatus(
  status: string,
): Exclude<PaymentState, 'CREATED'> {
  switch (status) {
    case 'paid':
    case 'partially_refunded': // был оплачен, позже частичный возврат
      return 'PAID';
    case 'cancelled':
    case 'cancelling':
      return 'CANCELLED';
    case 'expired':
      return 'EXPIRED';
    case 'error':
      return 'FAILED';
    default: // processing, pending и всё незнакомое — ещё ждём
      return 'PENDING';
  }
}

// ---------- Для ответа клиенту ----------

export type PaymentDto = {
  id: number;
  state: PaymentState;
  amount: number;
  phone: string;
  expiresAt: Date;
  paidAt: Date | null;
  /** Готовая фраза для участника, когда счёт не выставился или отменён. */
  message: string | null;
};

export function serializePayment(p: Payment): PaymentDto {
  return {
    id: p.id,
    state: p.state,
    amount: Number(p.amount),
    phone: p.phone,
    expiresAt: p.expiresAt,
    paidAt: p.paidAt,
    message: userMessage(p),
  };
}

function userMessage(p: Payment): string | null {
  switch (p.state) {
    case 'FAILED':
      return 'Не удалось выставить счёт в Kaspi. Проверьте, что номер привязан к Kaspi, и попробуйте ещё раз';
    case 'CANCELLED':
      return 'Счёт отменён. Чтобы занять место, зарегистрируйтесь ещё раз';
    case 'EXPIRED':
      return 'Время на оплату вышло, место освобождено. Можно зарегистрироваться ещё раз';
    default:
      return null;
  }
}

// ---------- Выставление счёта ----------

export type PaymentTarget =
  | { purpose: 'REGISTRATION'; registrationId: number }
  | { purpose: 'SEASON_PASS'; seasonPassId: number };

function targetWhere(t: PaymentTarget): Prisma.PaymentWhereInput {
  return t.purpose === 'REGISTRATION'
    ? { registrationId: t.registrationId }
    : { seasonPassId: t.seasonPassId };
}

function targetOf(p: Payment): PaymentTarget {
  return p.purpose === 'REGISTRATION'
    ? { purpose: 'REGISTRATION', registrationId: p.registrationId! }
    : { purpose: 'SEASON_PASS', seasonPassId: p.seasonPassId! };
}

/**
 * Действующий счёт по регистрации/абонементу, если он ещё не просрочен.
 * Нужен, чтобы повторное нажатие «Оплатить» не плодило счета в Kaspi.
 */
export function findActivePayment(target: PaymentTarget): Promise<Payment | null> {
  return prisma.payment.findFirst({
    where: { ...targetWhere(target), state: { in: ACTIVE }, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

export type StartPaymentInput = {
  userId: number;
  target: PaymentTarget;
  amount: number;
  phone: string; // уже нормализован: 8XXXXXXXXXX
  description: string;
  clientName?: string;
  log: Logger;
};

/**
 * Выставить счёт. Место к этому моменту уже занято (транзакция в роуте
 * закоммичена), а HTTP-запрос к ApiPay намеренно вне транзакции.
 *
 * Не бросает: при ошибке ApiPay платёж становится FAILED, место освобождается,
 * и роут отвечает участнику по state.
 */
export async function startPayment(input: StartPaymentInput): Promise<Payment> {
  const { userId, target, amount, phone, description, clientName, log } = input;

  // Прежние неоплаченные счета по той же цели гасим, чтобы у участника в Kaspi
  // не висело два счёта за одно место. Цель при этом НЕ освобождаем.
  await supersedeActive(target, log);

  const payment = await prisma.payment.create({
    data: {
      userId,
      purpose: target.purpose,
      registrationId: target.purpose === 'REGISTRATION' ? target.registrationId : null,
      seasonPassId: target.purpose === 'SEASON_PASS' ? target.seasonPassId : null,
      amount,
      phone,
      state: 'CREATED',
      expiresAt: new Date(Date.now() + paymentTtlMs()),
    },
  });

  let invoice: ApiPayInvoice;
  try {
    invoice = await createInvoice({
      phone,
      amount,
      description,
      externalOrderId: externalOrderId(payment.id),
      clientName,
    });
  } catch (err) {
    // Сюда попадает и таймаут, после которого счёт в Kaspi мог всё-таки
    // появиться. Не страшно: если его оплатят, вебхук найдёт платёж по
    // external_order_id (см. applyInvoice) и вернёт место.
    const message = err instanceof ApiPayError ? `${err.code ?? err.status}: ${err.message}` : String(err);
    log.error({ paymentId: payment.id, err: message }, 'Не удалось выставить счёт Kaspi');
    await prisma.payment.update({
      where: { id: payment.id },
      data: { error: message.slice(0, 500) },
    });
    await finishUnpaid(payment.id, 'FAILED', log);
    return (await prisma.payment.findUnique({ where: { id: payment.id } }))!;
  }

  const state = mapProviderStatus(invoice.status);
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerInvoiceId: invoice.id,
      providerStatus: invoice.status,
      // PAID проводим только через markPaid — там занимается место и уходит сообщение.
      state: state === 'PAID' ? 'PENDING' : state,
      error: invoice.error_code ?? null,
      checkedAt: new Date(),
    },
  });
  log.info(
    { paymentId: payment.id, invoiceId: invoice.id, status: invoice.status, sandbox: invoice.is_sandbox },
    'Счёт Kaspi выставлен',
  );

  if (state === 'PAID') return (await markPaid(updated.id, invoice, log)) ?? updated;
  if (state !== 'PENDING') {
    await finishUnpaid(updated.id, state, log, invoice.error_code ?? undefined);
    return (await prisma.payment.findUnique({ where: { id: payment.id } }))!;
  }
  return updated;
}

/** Наш id в счёте ApiPay — по нему находим платёж, если id счёта не сохранился. */
function externalOrderId(paymentId: number): string {
  return `fiveandfive-${paymentId}`;
}

function paymentIdFromExternal(value: string | null | undefined): number | null {
  const m = value?.match(/^fiveandfive-(\d+)$/);
  return m ? Number(m[1]) : null;
}

async function supersedeActive(target: PaymentTarget, log: Logger): Promise<void> {
  const old = await prisma.payment.findMany({
    where: { ...targetWhere(target), state: { in: ACTIVE } },
  });
  for (const p of old) {
    if (p.providerInvoiceId) {
      try {
        await cancelInvoice(p.providerInvoiceId);
      } catch (err) {
        log.warn({ paymentId: p.id, err: String(err) }, 'Не удалось отменить старый счёт');
      }
    }
    await prisma.payment.updateMany({
      where: { id: p.id, state: { in: ACTIVE } },
      data: { state: 'CANCELLED', error: 'superseded' },
    });
  }
}

// ---------- Применение статуса ----------

/**
 * Привести платёж к статусу счёта в ApiPay. Источник — вебхук, опрос или
 * фоновая сверка; статус всегда берём из GET /invoices/{id}, а не из тела
 * вебхука, поэтому подделать «оплату» нельзя даже при утечке формата.
 */
export async function applyInvoice(invoice: ApiPayInvoice, log: Logger): Promise<Payment | null> {
  let payment = await prisma.payment.findUnique({ where: { providerInvoiceId: invoice.id } });
  if (!payment) {
    // Счёт создан, но ответ ApiPay до нас не дошёл (таймаут) — связываем по
    // external_order_id, который мы сами передали при создании.
    const ownId = paymentIdFromExternal(invoice.external_order_id);
    const own = ownId ? await prisma.payment.findUnique({ where: { id: ownId } }) : null;
    if (!own || own.providerInvoiceId !== null) {
      log.warn({ invoiceId: invoice.id }, 'Счёт ApiPay без платежа в нашей базе');
      return null;
    }
    payment = await prisma.payment.update({
      where: { id: own.id },
      data: { providerInvoiceId: invoice.id },
    });
  }

  const next = mapProviderStatus(invoice.status);
  await prisma.payment.update({
    where: { id: payment.id },
    data: { providerStatus: invoice.status, checkedAt: new Date() },
  });

  if (next === 'PAID') return markPaid(payment.id, invoice, log);
  if (next === 'PENDING') return prisma.payment.findUnique({ where: { id: payment.id } });

  await finishUnpaid(payment.id, next, log, invoice.error_code ?? undefined);
  return prisma.payment.findUnique({ where: { id: payment.id } });
}

/** Спросить у ApiPay текущий статус и применить его. Ошибки сети — в лог. */
export async function refreshPayment(payment: Payment, log: Logger): Promise<Payment> {
  if (!payment.providerInvoiceId || !ACTIVE.includes(payment.state)) return payment;
  try {
    const invoice = await getInvoice(payment.providerInvoiceId);
    return (await applyInvoice(invoice, log)) ?? payment;
  } catch (err) {
    log.warn({ paymentId: payment.id, err: String(err) }, 'Не удалось узнать статус счёта');
    await prisma.payment.update({ where: { id: payment.id }, data: { checkedAt: new Date() } });
    return payment;
  }
}

/**
 * Оплата прошла. Идемпотентно: второй вызов (вебхук после опроса) ничего не
 * делает — в том числе не шлёт второе сообщение.
 */
export async function markPaid(
  paymentId: number,
  invoice: ApiPayInvoice | null,
  log: Logger,
): Promise<Payment | null> {
  const paidAt = invoice?.paid_at ? new Date(invoice.paid_at) : new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    const switched = await tx.payment.updateMany({
      where: { id: paymentId, state: { not: 'PAID' } },
      data: { state: 'PAID', paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt },
    });
    if (switched.count === 0) return null; // уже проведён

    const payment = (await tx.payment.findUnique({ where: { id: paymentId } }))!;
    const problems: string[] = [];

    if (payment.purpose === 'REGISTRATION') {
      const ok = await confirmRegistration(tx, payment.registrationId!);
      if (!ok) problems.push(`registration ${payment.registrationId}`);
    } else {
      await tx.seasonPass.update({
        where: { id: payment.seasonPassId! },
        data: { paymentStatus: 'PAID' },
      });
      const regs = await tx.registration.findMany({ where: { seasonPassId: payment.seasonPassId! } });
      for (const r of regs) {
        const ok = await confirmRegistration(tx, r.id);
        if (!ok) problems.push(`registration ${r.id}`);
      }
    }

    if (problems.length > 0) {
      // Оплатили после того, как место отдали другому, и свободных мест нет.
      // Деньги получены — нужен ручной разбор: вернуть или добавить место.
      await tx.payment.update({
        where: { id: paymentId },
        data: { error: `paid_but_no_slot: ${problems.join(', ')}` },
      });
    }
    return { payment, problems };
  });

  if (!outcome) return prisma.payment.findUnique({ where: { id: paymentId } });

  const { payment, problems } = outcome;
  if (problems.length > 0) {
    log.error(
      { paymentId, problems },
      'ОПЛАЧЕНО, НО МЕСТА НЕТ: нужен возврат или дополнительное место (см. payments.error)',
    );
  }
  log.info({ paymentId, invoiceId: payment.providerInvoiceId }, 'Оплата получена');
  // Если по той же цели висит ещё один счёт (участник сменил номер, а старый
  // счёт всё равно оплатил) — гасим его, чтобы не взять деньги дважды.
  await supersedeActive(targetOf(payment), log);
  await notifyPaid(payment, log);
  return payment;
}

/**
 * Регистрацию — в PAID. Если её уже успели отменить по таймауту, пробуем
 * снова занять место. false — мест нет, регистрация осталась отменённой.
 */
async function confirmRegistration(tx: Prisma.TransactionClient, registrationId: number): Promise<boolean> {
  const reg = await tx.registration.findUnique({
    where: { id: registrationId },
    include: { event: true },
  });
  if (!reg) return false;
  if (reg.paymentStatus === 'PAID') return true;

  if (reg.paymentStatus === 'CANCELLED') {
    const taken = await tx.event.updateMany({
      where: { id: reg.eventId, slotsTaken: { lt: reg.event.slotsTotal } },
      data: { slotsTaken: { increment: 1 } },
    });
    if (taken.count === 0) return false;
  }

  await tx.registration.update({
    where: { id: registrationId },
    data: { paymentStatus: 'PAID' },
  });
  return true;
}

async function notifyPaid(payment: Payment, log: Logger): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: payment.userId } });
  if (!user) return;

  if (payment.purpose === 'REGISTRATION') {
    const reg = await prisma.registration.findUnique({
      where: { id: payment.registrationId! },
      include: { event: true },
    });
    if (!reg || reg.paymentStatus !== 'PAID') return;
    await deliver({
      userId: user.id,
      telegramId: user.telegramId,
      eventId: reg.eventId,
      kind: 'REGISTERED',
      text: registrationText(reg.event),
      log,
    });
    return;
  }

  const regs = await prisma.registration.findMany({
    where: { seasonPassId: payment.seasonPassId!, paymentStatus: 'PAID' },
    include: { event: true },
  });
  if (regs.length === 0) return;
  await deliver({
    userId: user.id,
    telegramId: user.telegramId,
    eventId: null,
    kind: 'SEASON_PASS',
    text: seasonPassText(regs.map((r) => r.event)),
    log,
  });
}

/**
 * Платёж не состоится (отменён, просрочен, не выставился). Переводим его в
 * итоговый статус и, если другой живой попытки по той же цели нет, отпускаем
 * место. Идемпотентно.
 */
export async function finishUnpaid(
  paymentId: number,
  state: Exclude<PaymentState, 'PAID' | 'PENDING' | 'CREATED'>,
  log: Logger,
  errorCode?: string,
): Promise<void> {
  const released = await prisma.$transaction(async (tx) => {
    const switched = await tx.payment.updateMany({
      where: { id: paymentId, state: { in: ACTIVE } },
      data: { state, ...(errorCode ? { error: errorCode } : {}) },
    });
    if (switched.count === 0) return 0;

    const payment = (await tx.payment.findUnique({ where: { id: paymentId } }))!;
    const otherActive = await tx.payment.count({
      where: { ...targetWhere(targetOf(payment)), state: { in: ACTIVE }, id: { not: paymentId } },
    });
    if (otherActive > 0) return 0;

    return releaseTarget(tx, targetOf(payment));
  });

  log.info({ paymentId, state, slotsReleased: released }, 'Платёж закрыт без оплаты');
}

/** Отменить неоплаченные регистрации цели и вернуть места. Сколько мест вернули. */
async function releaseTarget(tx: Prisma.TransactionClient, target: PaymentTarget): Promise<number> {
  const regs =
    target.purpose === 'REGISTRATION'
      ? await tx.registration.findMany({ where: { id: target.registrationId } })
      : await tx.registration.findMany({ where: { seasonPassId: target.seasonPassId } });

  if (target.purpose === 'SEASON_PASS') {
    await tx.seasonPass.updateMany({
      where: { id: target.seasonPassId, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'CANCELLED' },
    });
  }

  let released = 0;
  for (const r of regs) {
    const cancelled = await tx.registration.updateMany({
      where: { id: r.id, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'CANCELLED' },
    });
    if (cancelled.count === 1) {
      await tx.event.update({
        where: { id: r.eventId },
        data: { slotsTaken: { decrement: 1 } },
      });
      released += 1;
    }
  }
  return released;
}

// ---------- Фоновая сверка ----------

/**
 * Раз в минуту из server.ts:
 *  - просроченные счета: последний раз спрашиваем статус (вдруг оплатили в
 *    последнюю секунду), иначе отменяем в Kaspi и освобождаем место;
 *  - живые счета, о которых давно ничего не слышно: сверяем статус — на случай,
 *    если вебхук потерялся.
 */
export async function sweepPayments(log: Logger): Promise<{ expired: number; checked: number }> {
  const now = new Date();
  let expired = 0;
  let checked = 0;

  const overdue = await prisma.payment.findMany({
    where: { state: { in: ACTIVE }, expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });
  for (const p of overdue) {
    const fresh = apiPayConfigured() ? await refreshPayment(p, log) : p;
    if (!ACTIVE.includes(fresh.state)) continue;
    if (fresh.providerInvoiceId && apiPayConfigured()) {
      try {
        await cancelInvoice(fresh.providerInvoiceId);
      } catch (err) {
        // Не отменился — не страшно: если участник всё же оплатит, markPaid
        // попробует вернуть ему место.
        log.warn({ paymentId: p.id, err: String(err) }, 'Не удалось отменить просроченный счёт');
      }
    }
    await finishUnpaid(p.id, 'EXPIRED', log);
    expired += 1;
  }

  if (apiPayConfigured()) {
    const stale = await prisma.payment.findMany({
      where: {
        state: 'PENDING',
        providerInvoiceId: { not: null },
        expiresAt: { gt: now },
        OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - 60_000) } }],
      },
      orderBy: { checkedAt: { sort: 'asc', nulls: 'first' } },
      take: 100,
    });
    for (const p of stale) {
      await refreshPayment(p, log);
      checked += 1;
    }
  }

  return { expired, checked };
}

/** Описание счёта для Kaspi: ApiPay показывает максимум 60 символов. */
export function invoiceDescription(title: string): string {
  const text = `5&5: ${title}`;
  return text.length <= 60 ? text : `${text.slice(0, 59)}…`;
}
