import { randomUUID } from 'node:crypto';
import type { Payment, Prisma, Registration, RefundRequest } from '@prisma/client';
import { prisma } from '../prisma';
import { ApiPayError, apiPayConfigured, createRefund, getInvoiceRefunds, type ApiPayRefund } from './apipay';
import { personLabel, writeAudit } from './audit';
import { distanceIdOf, releaseDistanceSlot } from './distances';
import { pickupStarted, releaseRegistrationBib } from './bibs';
import { startOfDayInTz } from './notify';
import { sendMessage } from './telegramBot';
import { adminTelegramIds } from './telegramLogin';
import { notifyRefund } from './refundNotify';

/**
 * Возвраты стартового взноса (оферта, п. 5.1, 5.3).
 *
 * С 2026-11-12 (решение пользователя) «Оформить возврат» сам вызывает возврат
 * через API ApiPay — POST /invoices/{id}/refund на сумму выбранных этапов:
 * - 100% и 50% — попытка RefundRequest: SENDING → PENDING (ApiPay принял) →
 *   COMPLETED по вебхуку invoice.refunded. Только тогда этапы становятся
 *   «Возврат» (место освобождается), появляются строки refunds, участнику —
 *   сообщение в бот и письмо;
 * - ошибка — FAILED с причиной: участнику ничего, владельцу — сообщение в
 *   Telegram, в админке «Повторить» или «Убрать»;
 * - 0% — без API: запись сразу «Возврат» без денег, сообщение участнику сразу.
 * Абонемент: один этап (цена абонемента / число стартов) или все оставшиеся —
 * у каждого свой процент по его дате; одна попытка на сумму всех этапов.
 *
 * Ручной возврат в кабинете ApiPay по-прежнему подхватывается вебхуком: если
 * по счёту есть неудачная попытка на ту же сумму — она закрывается этим
 * возвратом; иначе старт оформляется сам, по абонементу — сообщение владельцу.
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

export const money = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n).replace(/[\u00a0\u202f]/g, ' ')} ₸`;

export class RefundError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

type Db = Prisma.TransactionClient | typeof prisma;
type Logger = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };

/** Что вернуть по этапу — хранится в refund_requests.stages. */
export type RequestStage = { registrationId: number; eventId: number; eventTitle: string; percent: number; amount: number; base: number };

/** Попытки, которые ещё «держат» деньги или этап: новую по ним не начать. */
const OPEN: RefundRequest['status'][] = ['SENDING', 'PENDING', 'FAILED', 'UNCERTAIN'];

const stagesOf = (r: Pick<RefundRequest, 'stages'>): RequestStage[] => (Array.isArray(r.stages) ? (r.stages as unknown as RequestStage[]) : []);

/** Оплаченный платёж за регистрацию или абонемент. */
function paidPaymentOf(db: Db, reg: Pick<Registration, 'id' | 'seasonPassId'>): Promise<Payment | null> {
  return db.payment.findFirst({
    where: reg.seasonPassId ? { seasonPassId: reg.seasonPassId, state: 'PAID' } : { registrationId: reg.id, state: 'PAID' },
    orderBy: { paidAt: 'desc' },
  });
}

/**
 * Сколько уже возвращено по платежу (по этапам) плюс сколько сейчас в работе
 * у ApiPay. Возврат абонемента из ApiPay без этапа (registrationId null) сюда
 * не входит: это та же сумма, которую владелец потом отметит по этапам.
 */
async function refundedSoFar(db: Db, paymentId: number): Promise<number> {
  const agg = await db.refund.aggregate({ where: { paymentId, registrationId: { not: null } }, _sum: { amount: true } });
  const open = await db.refundRequest.aggregate({ where: { paymentId, status: { in: ['SENDING', 'PENDING', 'UNCERTAIN'] } }, _sum: { amount: true } });
  return Number(agg._sum.amount ?? 0) + Number(open._sum.amount ?? 0);
}

export type RefundStage = {
  registrationId: number;
  eventId: number;
  eventTitle: string;
  eventDate: Date;
  /** Цена этапа: старт — сумма платежа, абонемент — сумма / число стартов. */
  base: number;
  /** Можно оформить: оплачено, возврата не было и нет попытки в работе. */
  refundable: boolean;
  /** Почему нельзя — «возврат уже оформлен», «возврат отправлен…». */
  note: string | null;
  suggested: RefundPercent;
  daysLeft: number;
  rule: string;
  /**
   * Выдача пакетов на этом старте уже началась: по оферте возврат не
   * производится, и номер при оформлении останется за участником.
   */
  pickupStarted: boolean;
  bibNumber: number | null;
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
  /** Возврат через API возможен: ApiPay подключён и у оплаты есть счёт. */
  viaApi: boolean;
  /** Для старта — один этап; для абонемента — все старты абонемента. */
  stages: RefundStage[];
};

const REQUEST_NOTE: Partial<Record<RefundRequest['status'], string>> = {
  SENDING: 'возврат отправляется в ApiPay',
  PENDING: 'возврат отправлен, ждём подтверждения ApiPay',
  FAILED: 'возврат не прошёл — «Повторить» или «Убрать» в списке участников',
  UNCERTAIN: 'исход возврата неизвестен — разбирает ApiPay',
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

  const open = await prisma.refundRequest.findMany({ where: { paymentId: payment.id, status: { in: OPEN } } });
  const openOf = new Map<number, RefundRequest>();
  for (const r of open) for (const s of stagesOf(r)) openOf.set(s.registrationId, r);

  const started = new Map<number, boolean>();
  for (const r of regs) started.set(r.id, await pickupStarted(prisma, r.event, now));

  const stages = regs.map((r): RefundStage => {
    const pickup = started.get(r.id)!;
    const s = pickup
      ? { percent: 0 as RefundPercent, daysLeft: suggestedPercent(r.event.date, now).daysLeft, rule: 'выдача пакетов уже началась — по оферте возврат не производится' }
      : suggestedPercent(r.event.date, now);
    const req = openOf.get(r.id);
    const note = r.refundedAt
      ? 'возврат уже оформлен'
      : req
        ? REQUEST_NOTE[req.status] ?? 'возврат в работе'
        : r.paymentStatus !== 'PAID'
          ? 'запись не оплачена или отменена'
          : null;
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
      pickupStarted: pickup,
      bibNumber: r.bibNumber,
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
    viaApi: apiPayConfigured() && payment.providerInvoiceId !== null,
    stages,
  };
}

/** Перевести этап в «Возврат»: CANCELLED + refundedAt, место — свободно. false — запись уже изменилась. */
async function markStageRefunded(tx: Prisma.TransactionClient, reg: Registration, strict = true): Promise<boolean> {
  const distanceId = await distanceIdOf(tx, reg);
  const res = await tx.registration.updateMany({
    where: { id: reg.id, paymentStatus: 'PAID', refundedAt: null },
    data: { paymentStatus: 'CANCELLED', refundedAt: new Date(), ...(distanceId ? { distanceId } : {}) },
  });
  if (res.count !== 1) {
    if (strict) throw new RefundError('Запись уже изменилась — обновите список');
    return false;
  }
  if (distanceId) await releaseDistanceSlot(tx, distanceId);
  // Номер — в пул, если выдача пакетов ещё не началась; иначе остаётся за записью.
  await releaseRegistrationBib(tx, reg);
  return true;
}

const auditValue = (percent: number | null, amount: number) => `${percent === null ? '' : `${percent}% · `}${money(amount)}`;

async function tellAdmins(text: string, log?: Pick<Logger, 'warn'>): Promise<void> {
  for (const id of adminTelegramIds()) {
    const res = await sendMessage(String(id), text);
    if (!res.ok) log?.warn({ telegramId: id, error: res.error }, 'Не удалось сообщить о возврате');
  }
}

// ---------- Причины отказа ApiPay — по-русски ----------

const REASONS: Record<string, string> = {
  refund_window_expired: 'истёк срок возврата через Kaspi (около 14 дней после оплаты). Верните деньги вручную в Kaspi Pay',
  refund_rejected_by_kaspi: 'Kaspi отказал в возврате без подтверждения покупателя. Проведите возврат вручную в Kaspi Pay',
  refund_requires_buyer_confirmation: 'Kaspi требует подтверждения покупателя. Проведите возврат вручную в Kaspi Pay',
  refund_insufficient_funds: 'на счёте Kaspi Pay не хватает денег. Пополните счёт и нажмите «Повторить»',
  refund_amount_exceeds_available: 'сумма больше доступной к возврату по этому счёту',
  qr_refund_link_invoice_busy: 'по этому счёту уже идёт другой возврат. Дождитесь его и нажмите «Повторить»',
  kaspi_throttled: 'Kaspi временно ограничил запросы. Нажмите «Повторить» позже',
  network_unavailable: 'Kaspi временно недоступен. Нажмите «Повторить» позже',
  kaspi_error: 'Kaspi отказал или не ответил. Нажмите «Повторить» позже; не пройдёт — верните вручную в Kaspi Pay',
  unknown_error: 'неизвестная ошибка Kaspi. Нажмите «Повторить» позже',
  tariff_inactive: 'подписка ApiPay не активна. Продлите тариф в кабинете ApiPay',
  kaspi_session_not_configured: 'в ApiPay нет активного кассира Kaspi. Подключите кассира в кабинете ApiPay',
  kaspi_session_expired: 'сессия кассира Kaspi истекла. Переавторизуйте кассира в кабинете ApiPay',
  kaspi_session_invalid: 'сессия кассира Kaspi недоступна. Переавторизуйте кассира в кабинете ApiPay',
  refund_resolved_not_executed: 'ApiPay разобрал возврат: деньги не ушли. Можно нажать «Повторить»',
  invoice_not_refundable: 'счёт нельзя вернуть (не оплачен или уже возвращён полностью)',
  not_configured: 'ApiPay не подключён (нет ключа API)',
};

export function refundReason(code: string | null, message?: string | null): string {
  if (code && REASONS[code]) return REASONS[code];
  return [code, message].filter(Boolean).join(': ') || 'причина не указана';
}

// ---------- Оформление из админки ----------

export type AdminRefundResult = {
  total: number;
  stages: number;
  /** api — деньги отправлены в ApiPay; zero — только 0%, без денег. */
  mode: 'api' | 'zero';
  status: RefundRequest['status'] | null;
  requestId: number | null;
  error: string | null;
};

/**
 * Оформить возврат из админки. stages — какие этапы и под каким процентом;
 * для старта — ровно один (сама регистрация). wholePass — все оставшиеся
 * этапы абонемента, тогда абонемент CANCELLED (после подтверждения денег).
 */
export async function applyAdminRefund(input: {
  registrationId: number;
  stages: { registrationId: number; percent: RefundPercent }[];
  wholePass: boolean;
  adminTelegramId: number;
  log?: Logger;
}): Promise<AdminRefundResult> {
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

  const rows: RequestStage[] = input.stages.map((s) => {
    const stage = byId.get(s.registrationId)!;
    return {
      registrationId: stage.registrationId,
      eventId: stage.eventId,
      eventTitle: stage.eventTitle,
      percent: s.percent,
      amount: Math.round((stage.base * s.percent) / 100),
      base: stage.base,
    };
  });
  const zero = rows.filter((r) => r.amount === 0);
  const paidRows = rows.filter((r) => r.amount > 0);
  const total = paidRows.reduce((sum, r) => sum + r.amount, 0);

  if (paidRows.length > 0 && !preview.viaApi) {
    throw new RefundError(
      apiPayConfigured()
        ? 'У этой оплаты нет счёта ApiPay — возврат через API невозможен. Верните деньги вручную в Kaspi Pay'
        : 'ApiPay не подключён — возврат через API невозможен',
    );
  }

  // 0% — сразу: запись «Возврат» без денег, строка refunds на 0 ₸.
  let request = null as RefundRequest | null;
  await prisma.$transaction(async (tx) => {
    if ((await refundedSoFar(tx, preview.paymentId)) + total > preview.paid) {
      throw new RefundError('Сумма возвратов больше, чем оплачено');
    }
    for (const z of zero) {
      const reg = await tx.registration.findUniqueOrThrow({ where: { id: z.registrationId }, include: { user: true } });
      await markStageRefunded(tx, reg);
      await tx.refund.create({
        data: {
          userId: reg.userId,
          paymentId: preview.paymentId,
          registrationId: reg.id,
          seasonPassId: preview.seasonPassId,
          eventId: reg.eventId,
          percent: z.percent,
          amount: 0,
          source: 'ADMIN',
          adminTelegramId: BigInt(input.adminTelegramId),
          confirmedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        adminTelegramId: input.adminTelegramId,
        action: 'registration.refund',
        eventId: reg.eventId,
        registrationId: reg.id,
        userId: reg.userId,
        subject: personLabel(reg.user),
        changes: { paymentStatus: ['PAID', 'REFUNDED'], refund: [null, auditValue(z.percent, 0)] },
      });
    }
    if (paidRows.length > 0) {
      const owner = await tx.registration.findUniqueOrThrow({ where: { id: input.registrationId }, select: { userId: true } });
      request = await tx.refundRequest.create({
        data: {
          paymentId: preview.paymentId,
          userId: owner.userId,
          amount: total,
          wholePass: preview.kind === 'pass' && input.wholePass,
          stages: paidRows as unknown as Prisma.InputJsonValue,
          idempotencyKey: `refund-${preview.paymentId}-${randomUUID()}`,
          adminTelegramId: BigInt(input.adminTelegramId),
        },
      });
    } else if (preview.kind === 'pass' && input.wholePass && preview.seasonPassId) {
      await tx.seasonPass.update({ where: { id: preview.seasonPassId }, data: { paymentStatus: 'CANCELLED', refundedAt: new Date() } });
    }
  });

  if (!request) {
    // Только 0% — денег нет, сообщаем участнику сразу.
    await notifyOwner(input.registrationId, {
      kind: preview.kind,
      wholePass: preview.kind === 'pass' && input.wholePass,
      lines: zero,
    }, input.log);
    return { total: 0, stages: rows.length, mode: 'zero', status: null, requestId: null, error: null };
  }

  const sent = await sendRequest(request, input.log);
  return {
    total,
    stages: rows.length,
    mode: 'api',
    status: sent.status,
    requestId: sent.id,
    error: sent.status === 'FAILED' ? refundReason(sent.errorCode, sent.errorMessage) : null,
  };
}

async function notifyOwner(
  registrationId: number,
  n: { kind: 'single' | 'pass'; wholePass: boolean; lines: RequestStage[] },
  log?: Logger,
): Promise<void> {
  try {
    const owner = await prisma.registration.findUnique({ where: { id: registrationId }, include: { user: true } });
    if (owner) {
      await notifyRefund(
        owner.user,
        { kind: n.kind, wholePass: n.wholePass, lines: n.lines.map((l) => ({ eventId: l.eventId, title: l.eventTitle, amount: l.amount, percent: l.percent, base: l.base })) },
        log,
      );
    }
  } catch (err) {
    log?.warn({ registrationId, err: err instanceof Error ? err.message : String(err) }, 'Не удалось сообщить участнику о возврате');
  }
}

/**
 * Отправить попытку в ApiPay (или повторить с её ключом). Сетевой сбой —
 * остаётся SENDING: повтор с тем же ключом безопасен (вернётся тот же возврат).
 */
async function sendRequest(req: RefundRequest, log?: Logger, simulate?: Parameters<typeof createRefund>[1]['simulate']): Promise<RefundRequest> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: req.paymentId } });
  if (!payment.providerInvoiceId) return failRequest(req, 'no_invoice', 'у оплаты нет счёта ApiPay', log);
  const titles = stagesOf(req).map((s) => s.eventTitle).join(', ');
  try {
    const res = await createRefund(payment.providerInvoiceId, {
      amount: Math.round(Number(req.amount)),
      idempotencyKey: req.idempotencyKey,
      reason: `Возврат 5&5: ${titles}`,
      simulate,
    });
    const r = res.refund;
    if (!r?.id) {
      log?.warn({ requestId: req.id, res }, 'ApiPay: ответ на возврат без id');
      return prisma.refundRequest.update({ where: { id: req.id }, data: { status: 'SENDING' } });
    }
    const updated = await prisma.refundRequest.update({
      where: { id: req.id },
      data: { status: 'PENDING', providerRefundId: r.id, errorCode: null, errorMessage: null },
    });
    log?.info({ requestId: req.id, refundId: r.id, status: r.status }, 'Возврат отправлен в ApiPay');
    // Повтор ключа может сразу принести итог.
    return applyProviderRefund(updated, r, log);
  } catch (err) {
    if (err instanceof ApiPayError && err.status === 0 && err.code !== 'not_configured' && err.code !== 'bad_amount') {
      log?.warn({ requestId: req.id, err: err.message }, 'ApiPay не ответил на возврат — повторим с тем же ключом');
      return prisma.refundRequest.update({ where: { id: req.id }, data: { status: 'SENDING', errorCode: 'no_response', errorMessage: err.message.slice(0, 300) } });
    }
    const code = err instanceof ApiPayError ? err.code ?? `http_${err.status}` : 'error';
    const message = err instanceof Error ? err.message : String(err);
    return failRequest(req, code, message, log);
  }
}

async function failRequest(req: RefundRequest, code: string | null, message: string | null, log?: Logger): Promise<RefundRequest> {
  const fresh = await prisma.refundRequest.findUniqueOrThrow({ where: { id: req.id } });
  if (fresh.status === 'COMPLETED' || fresh.status === 'DISMISSED') return fresh;
  const already = fresh.status === 'FAILED' && fresh.errorCode === code;
  const updated = await prisma.refundRequest.update({
    where: { id: req.id },
    data: { status: 'FAILED', errorCode: code, errorMessage: message?.slice(0, 300) ?? null },
  });
  if (!already) {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    const who = user ? personLabel(user) : `участник #${req.userId}`;
    await tellAdmins(
      `⚠️ Возврат ${money(Math.round(Number(req.amount)))} (${who}, ${stagesOf(req).map((s) => `«${s.eventTitle}»`).join(', ')}) не прошёл: ` +
        `${refundReason(code, message)}.\n\nУчастнику ничего не отправлено. В админке — «Повторить» или «Убрать».`,
      log,
    );
    log?.warn({ requestId: req.id, code, message }, 'Возврат ApiPay не прошёл');
  }
  return updated;
}

/** Итог возврата от ApiPay (из ответа или GET /invoices/{id}/refunds). */
async function applyProviderRefund(req: RefundRequest, r: ApiPayRefund, log?: Logger): Promise<RefundRequest> {
  if (r.status === 'completed') return completeRequest(req, r.id, log);
  if (r.status === 'failed') {
    // Разбор «неизвестного исхода»: деньги ушли отдельной строкой — её и ждём.
    if (r.error_code === 'refund_resolved_executed') return req;
    return failRequest(req, r.error_code ?? null, null, log);
  }
  if (r.error_code === 'refund_execution_uncertain' && req.status !== 'UNCERTAIN') {
    const updated = await prisma.refundRequest.update({ where: { id: req.id }, data: { status: 'UNCERTAIN', errorCode: r.error_code } });
    await tellAdmins(
      `❓ Возврат ${money(Math.round(Number(req.amount)))} по счёту — исход неизвестен: деньги могли уйти. Не повторяйте его и не возвращайте вручную — ` +
        'ApiPay разберёт по истории Kaspi, итог придёт сам.',
      log,
    );
    return updated;
  }
  return req;
}

/** Деньги ушли: этапы — «Возврат», строки refunds, абонемент, журнал, участнику — сообщение. */
async function completeRequest(req: RefundRequest, providerRefundId: number, log?: Logger): Promise<RefundRequest> {
  const fresh = await prisma.refundRequest.findUniqueOrThrow({ where: { id: req.id } });
  if (fresh.status === 'COMPLETED') return fresh;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: fresh.paymentId } });
  const stages = stagesOf(fresh);
  const adminId = fresh.adminTelegramId !== null ? Number(fresh.adminTelegramId) : 0;
  const changed: string[] = [];
  const updated = await prisma.$transaction(async (tx) => {
    let first = true;
    for (const s of stages) {
      const reg = await tx.registration.findUnique({ where: { id: s.registrationId }, include: { user: true } });
      const marked = reg ? await markStageRefunded(tx, reg, false) : false;
      if (reg && !marked) changed.push(s.eventTitle);
      await tx.refund.create({
        data: {
          userId: fresh.userId,
          paymentId: fresh.paymentId,
          registrationId: reg ? reg.id : null,
          seasonPassId: payment.seasonPassId,
          eventId: s.eventId,
          percent: s.percent,
          amount: s.amount,
          source: 'ADMIN',
          adminTelegramId: fresh.adminTelegramId,
          // Строк по этапам несколько, а возврат ApiPay один — id у первой.
          providerRefundId: first ? providerRefundId : null,
          requestId: fresh.id,
          confirmedAt: new Date(),
        },
      });
      first = false;
      if (reg) {
        await writeAudit(tx, {
          adminTelegramId: adminId,
          action: 'registration.refund',
          eventId: reg.eventId,
          registrationId: reg.id,
          userId: reg.userId,
          subject: personLabel(reg.user),
          changes: {
            ...(marked ? { paymentStatus: ['PAID', 'REFUNDED'] as [string, string] } : {}),
            refund: [null, `${auditValue(s.percent, s.amount)} (ApiPay подтвердил)`],
          },
        });
      }
    }
    if (fresh.wholePass && payment.seasonPassId) {
      await tx.seasonPass.update({ where: { id: payment.seasonPassId }, data: { paymentStatus: 'CANCELLED', refundedAt: new Date() } });
    }
    return tx.refundRequest.update({
      where: { id: fresh.id },
      data: { status: 'COMPLETED', providerRefundId: fresh.providerRefundId ?? providerRefundId, completedAt: new Date(), errorCode: null, errorMessage: null },
    });
  });
  log?.info({ requestId: fresh.id, providerRefundId }, 'Возврат ApiPay подтверждён');

  if (!updated.notifiedAt && stages[0]) {
    await notifyOwner(stages[0].registrationId, { kind: payment.purpose === 'SEASON_PASS' ? 'pass' : 'single', wholePass: fresh.wholePass, lines: stages }, log);
    await prisma.refundRequest.update({ where: { id: fresh.id }, data: { notifiedAt: new Date() } });
  }
  const user = await prisma.user.findUnique({ where: { id: fresh.userId } });
  await tellAdmins(
    `↩️ ApiPay подтвердил возврат ${money(Math.round(Number(fresh.amount)))} — ${user ? personLabel(user) : `участник #${fresh.userId}`}, ` +
      `${stages.map((s) => `«${s.eventTitle}»`).join(', ')}. Участнику отправлено сообщение.` +
      (changed.length ? ` Запись по ${changed.map((t) => `«${t}»`).join(', ')} к этому моменту уже была изменена — проверьте её.` : ''),
    log,
  );
  return { ...updated, notifiedAt: updated.notifiedAt ?? new Date() };
}

/** «Повторить»: неудачная — с новым ключом; без ответа — с тем же. */
export async function retryRefundRequest(id: number, log?: Logger): Promise<RefundRequest> {
  const req = await prisma.refundRequest.findUnique({ where: { id } });
  if (!req) throw new RefundError('Возврат не найден', 404);
  if (req.status !== 'FAILED' && req.status !== 'SENDING') throw new RefundError('Повторить можно только возврат, который не прошёл');
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: req.paymentId } });
  const regs = await prisma.registration.findMany({ where: { id: { in: stagesOf(req).map((s) => s.registrationId) } } });
  if (regs.some((r) => r.refundedAt || r.paymentStatus !== 'PAID')) {
    throw new RefundError('Запись уже изменилась (отменена или возвращена) — уберите эту попытку и оформите возврат заново');
  }
  if (payment.state !== 'PAID') throw new RefundError('Оплата уже не в статусе «Оплачено»');
  const next = await prisma.refundRequest.update({
    where: { id },
    data:
      req.status === 'FAILED'
        ? { status: 'SENDING', idempotencyKey: `refund-${req.paymentId}-${randomUUID()}`, providerRefundId: null, attempts: { increment: 1 }, errorCode: null, errorMessage: null }
        : { attempts: { increment: 1 } },
  });
  return sendRequest(next, log);
}

/** «Убрать» неудачную попытку — чтобы оформить возврат заново (например, с другим процентом). */
export async function dismissRefundRequest(id: number): Promise<void> {
  const res = await prisma.refundRequest.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'DISMISSED' } });
  if (res.count !== 1) throw new RefundError('Убрать можно только возврат, который не прошёл');
}

/** Для списка участников: открытая попытка по каждой регистрации. */
export async function openRequestsByRegistration(registrationIds: number[]): Promise<Map<number, RefundRequest>> {
  const out = new Map<number, RefundRequest>();
  if (registrationIds.length === 0) return out;
  const want = new Set(registrationIds);
  const regs = await prisma.registration.findMany({ where: { id: { in: registrationIds } }, select: { id: true, payments: { select: { id: true } }, seasonPass: { select: { payments: { select: { id: true } } } } } });
  const paymentIds = [...new Set(regs.flatMap((r) => [...r.payments, ...(r.seasonPass?.payments ?? [])].map((p) => p.id)))];
  const reqs = await prisma.refundRequest.findMany({ where: { paymentId: { in: paymentIds }, status: { in: OPEN } }, orderBy: { createdAt: 'asc' } });
  for (const r of reqs) for (const s of stagesOf(r)) if (want.has(s.registrationId)) out.set(s.registrationId, r);
  return out;
}

// ---------- Вебхук ApiPay invoice.refunded и фоновая сверка ----------

/**
 * Свести возвраты счёта с нашими. Список берём GET /invoices/{id}/refunds,
 * а не из тела вебхука. Повторный вызов безопасен.
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
    // 1) Наш возврат из админки — по id ApiPay.
    const ours = await prisma.refundRequest.findUnique({ where: { providerRefundId: r.id } });
    if (ours) {
      if (ours.status !== 'COMPLETED' && ours.status !== 'DISMISSED') await applyProviderRefund(ours, r, log);
      continue;
    }
    if (r.status === 'failed') {
      // Неудачный ручной возврат из кабинета: сообщаем один раз, в суммы не идёт.
      await prisma.refundRequest.create({
        data: {
          paymentId: payment.id,
          userId: payment.userId,
          amount: Number(r.amount) || 0,
          stages: [],
          status: 'FAILED',
          idempotencyKey: `manual-failed-${r.id}`,
          providerRefundId: r.id,
          errorCode: r.error_code ?? null,
        },
      });
      await tellAdmins(`⚠️ Возврат ${money(Number(r.amount))} (${who}) в ApiPay не прошёл: ${refundReason(r.error_code ?? null)}.`, log);
      continue;
    }
    if (r.status !== 'completed') continue;
    if (await prisma.refund.findUnique({ where: { providerRefundId: r.id } })) continue;

    const amount = Math.round(Number(r.amount));
    // 2) Ручной возврат в кабинете вместо неудачной (или зависшей) попытки на ту же сумму.
    const stuck = await prisma.refundRequest.findFirst({
      where: { paymentId: payment.id, status: { in: ['FAILED', 'SENDING'] }, amount },
      orderBy: { createdAt: 'asc' },
    });
    if (stuck && stagesOf(stuck).length > 0) {
      await completeRequest(stuck, r.id, log);
      continue;
    }

    // 3) В админке не оформляли. Старт — оформляем сами; абонемент — пишем владельцу.
    const paid = Math.round(Number(payment.amount));
    if (payment.purpose === 'REGISTRATION' && payment.registrationId) {
      const percent = paid > 0 ? Math.round((amount / paid) * 100) : null;
      const reg = await prisma.registration.findUnique({ where: { id: payment.registrationId }, include: { user: true, event: true } });
      let marked = false;
      await prisma.$transaction(async (tx) => {
        if (reg) marked = await markStageRefunded(tx, reg, false);
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
      if (reg && marked) {
        await notifyRefund(reg.user, { kind: 'single', wholePass: false, lines: [{ eventId: reg.eventId, title: reg.event.title, amount, percent: percent ?? 100, base: paid }] }, log);
      }
      await tellAdmins(
        `↩️ ApiPay: возврат ${money(amount)} — ${who}${reg ? `, «${reg.event.title}»` : ''}.` +
          (marked ? ' В админке запись переведена в «Возврат», место освобождено, участнику отправлено сообщение.' : ' Запись уже была отменена — отметили только сумму.'),
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
        `↩️ ApiPay: возврат ${money(amount)} по абонементу — ${who}. Отметьте в админке, за какие этапы: сам этап по сумме не определить. ` +
          'Участнику сообщение не отправлено.',
        log,
      );
    }
    log.info({ paymentId: payment.id, refundId: r.id, amount }, 'Возврат ApiPay учтён');
  }
}

/**
 * Фоновая сверка (раз в минуту вместе с оплатами): вебхук мог потеряться.
 * PENDING и UNCERTAIN старше 2 минут — перечитываем возвраты счёта; SENDING
 * (ответа не было) — повторяем с тем же ключом.
 */
export async function sweepRefundRequests(log: Logger): Promise<{ checked: number; resent: number }> {
  const before = new Date(Date.now() - 2 * 60_000);
  const open = await prisma.refundRequest.findMany({
    where: { status: { in: ['SENDING', 'PENDING', 'UNCERTAIN'] }, updatedAt: { lt: before } },
    include: { payment: { select: { providerInvoiceId: true } } },
    take: 20,
  });
  let checked = 0;
  let resent = 0;
  const invoices = new Set<number>();
  for (const r of open) {
    if (r.status === 'SENDING') {
      if (r.attempts >= 10) continue;
      await prisma.refundRequest.update({ where: { id: r.id }, data: { attempts: { increment: 1 } } });
      await sendRequest(r, log);
      resent += 1;
    } else if (r.payment.providerInvoiceId) invoices.add(r.payment.providerInvoiceId);
  }
  for (const id of invoices) {
    await syncApiPayRefunds(id, log);
    checked += 1;
  }
  // Чтобы перечитанные, но ещё не завершённые не перебирались каждую минуту.
  if (invoices.size) {
    await prisma.refundRequest.updateMany({ where: { id: { in: open.filter((r) => r.status !== 'SENDING').map((r) => r.id) }, status: { in: ['PENDING', 'UNCERTAIN'] } }, data: { updatedAt: new Date() } });
  }
  return { checked, resent };
}

/** Только для проверки на staging (песочница): отправить попытку с заказанным исходом. */
export const __test = { sendRequest };
