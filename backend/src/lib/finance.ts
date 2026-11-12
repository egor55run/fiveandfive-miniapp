import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ymdInTz } from './notify';

/**
 * «Финансы» в админке (2026-11-12): только чтение, всё считается из базы.
 *
 * Деньги приписываются стартам так:
 * - оплата старта — целиком этому старту;
 * - оплата абонемента — поровну всем стартам абонемента (сумма / число стартов,
 *   так же считает возвраты refunds.ts), остаток от деления — первому старту,
 *   чтобы доли в сумме давали ровно оплату.
 * Возвраты — по старту возврата (refund.eventId). Возврат абонемента из ApiPay
 * без этапа (registrationId null) в суммы не входит: ту же сумму организатор
 * отмечает по этапам в админке, иначе она посчиталась бы дважды. Такие
 * возвраты показываем отдельно — «ждут разметки по этапам».
 *
 * Период — по дате оплаты (paidAt) и дате оформления возврата (createdAt),
 * границы — календарные дни по Астане.
 */

export type FinanceScope =
  | { kind: 'all' }
  | { kind: 'season'; seasonId: number }
  | { kind: 'event'; eventId: number };

export type FinanceFilter = { scope: FinanceScope; from: string | null; to: string | null };

const TZ_OFFSET = '+05:00';
const DAY_MS = 86_400_000;
const round = (n: number) => Math.round(n * 100) / 100;

const fullName = (u: { lastName: string | null; firstName: string }) => [u.lastName, u.firstName].filter(Boolean).join(' ');

function range(f: FinanceFilter): { gte?: Date; lt?: Date } | undefined {
  const r: { gte?: Date; lt?: Date } = {};
  if (f.from) r.gte = new Date(`${f.from}T00:00:00${TZ_OFFSET}`);
  if (f.to) r.lt = new Date(new Date(`${f.to}T00:00:00${TZ_OFFSET}`).getTime() + DAY_MS);
  return r.gte || r.lt ? r : undefined;
}

type EventInfo = { id: number; title: string; date: Date; seasonId: number | null };

/** Подходит ли старт под фильтр. */
function inScope(scope: FinanceScope, e: EventInfo | undefined, seasonIdOfPass?: number | null): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'event') return e?.id === scope.eventId;
  return (e?.seasonId ?? seasonIdOfPass ?? null) === scope.seasonId;
}

export type CsvRow = {
  date: string;
  type: 'Оплата' | 'Возврат';
  participant: string;
  telegram: string;
  event: string;
  distance: string;
  kind: 'Старт' | 'Абонемент';
  amount: number;
  /** Доля выбранного старта в оплате абонемента. */
  share: number | null;
  discount: number | null;
  promoCode: string | null;
  percent: number | null;
  status: string;
  invoice: string;
};

export async function financeReport(f: FinanceFilter) {
  const events: EventInfo[] = await prisma.event.findMany({ select: { id: true, title: true, date: true, seasonId: true } });
  const eventById = new Map(events.map((e) => [e.id, e]));
  const paidAt = range(f);

  // ---------- Оплаты ----------
  const payments = await prisma.payment.findMany({
    where: { state: 'PAID', ...(paidAt ? { paidAt } : {}) },
    orderBy: { paidAt: 'asc' },
    include: {
      user: { select: { firstName: true, lastName: true, username: true, telegramId: true } },
      promoCode: { select: { code: true } },
      registration: { select: { eventId: true, distance: { select: { label: true } } } },
      seasonPass: {
        select: {
          seasonId: true,
          season: { select: { title: true } },
          registrations: { select: { eventId: true, distance: { select: { label: true } } }, orderBy: { event: { date: 'asc' } } },
        },
      },
    },
  });

  type Alloc = { eventId: number; amount: number; distance: string | null };
  const allocOf = (p: (typeof payments)[number]): Alloc[] => {
    const amount = Number(p.amount);
    if (p.purpose === 'REGISTRATION' && p.registration) {
      return [{ eventId: p.registration.eventId, amount, distance: p.registration.distance?.label ?? null }];
    }
    const regs = p.seasonPass?.registrations ?? [];
    if (regs.length === 0) return [];
    const each = Math.floor((amount / regs.length) * 100) / 100;
    return regs.map((r, i) => ({
      eventId: r.eventId,
      amount: i === 0 ? round(amount - each * (regs.length - 1)) : each,
      distance: r.distance?.label ?? null,
    }));
  };

  let paidSum = 0;
  let paidCount = 0;
  let singleSum = 0;
  let singleCount = 0;
  let passSum = 0;
  let passCount = 0;
  const byDay = new Map<string, { amount: number; count: number }>();
  const csv: CsvRow[] = [];
  const paymentInScope = new Set<number>();

  for (const p of payments) {
    const allocs = allocOf(p);
    const isPass = p.purpose === 'SEASON_PASS';
    const inside =
      f.scope.kind === 'event'
        ? allocs.filter((a) => a.eventId === (f.scope as { eventId: number }).eventId)
        : allocs.filter((a) => inScope(f.scope, eventById.get(a.eventId), p.seasonPass?.seasonId));
    // Абонемент без стартов (не должно быть) — по сезону.
    const passNoRegs = isPass && allocs.length === 0 && inScope(f.scope, undefined, p.seasonPass?.seasonId) && f.scope.kind !== 'event';
    if (inside.length === 0 && !passNoRegs) continue;
    paymentInScope.add(p.id);
    const amount = passNoRegs ? Number(p.amount) : round(inside.reduce((s, a) => s + a.amount, 0));
    paidSum += amount;
    paidCount += 1;
    if (isPass) {
      passSum += amount;
      passCount += 1;
    } else {
      singleSum += amount;
      singleCount += 1;
    }
    const day = ymdInTz(p.paidAt ?? p.createdAt);
    const d = byDay.get(day) ?? { amount: 0, count: 0 };
    d.amount = round(d.amount + amount);
    d.count += 1;
    byDay.set(day, d);

    const refunded = Number(p.refundedAmount);
    const full = Number(p.amount);
    const eventTitle = isPass
      ? f.scope.kind === 'event'
        ? `${eventById.get((f.scope as { eventId: number }).eventId)?.title ?? ''} (абонемент «${p.seasonPass?.season.title ?? ''}»)`
        : `Абонемент «${p.seasonPass?.season.title ?? ''}»`
      : eventById.get(p.registration?.eventId ?? 0)?.title ?? '';
    csv.push({
      date: (p.paidAt ?? p.createdAt).toISOString(),
      type: 'Оплата',
      participant: fullName(p.user),
      telegram: p.user.username ? `@${p.user.username}` : String(p.user.telegramId ?? ''),
      event: eventTitle,
      distance: [...new Set((inside.length ? inside : allocs).map((a) => a.distance).filter(Boolean))].join(', '),
      kind: isPass ? 'Абонемент' : 'Старт',
      amount: full,
      share: isPass && f.scope.kind === 'event' ? amount : null,
      discount: Number(p.discount) > 0 ? Number(p.discount) : null,
      promoCode: p.promoCode?.code ?? null,
      percent: null,
      status: refunded <= 0 ? 'Оплачено' : refunded >= full ? 'Оплачено, возвращено полностью' : `Оплачено, возвращено ${refunded} ₸`,
      invoice: p.providerInvoiceId ? String(p.providerInvoiceId) : '',
    });
  }

  // ---------- Возвраты ----------
  const refunds = await prisma.refund.findMany({
    where: paidAt ? { createdAt: paidAt } : {},
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { firstName: true, lastName: true, username: true, telegramId: true } },
      payment: { select: { providerInvoiceId: true } },
      registration: { select: { distance: { select: { label: true } } } },
      seasonPass: { select: { seasonId: true, season: { select: { title: true } } } },
    },
  });
  let refundSum = 0;
  let refundCount = 0;
  const byPercent: Record<'100' | '50' | '0' | 'other', { amount: number; count: number }> = {
    '100': { amount: 0, count: 0 },
    '50': { amount: 0, count: 0 },
    '0': { amount: 0, count: 0 },
    other: { amount: 0, count: 0 },
  };
  const unassigned = { amount: 0, count: 0 };
  const refundByDay = new Map<string, number>();
  for (const r of refunds) {
    const e = r.eventId ? eventById.get(r.eventId) : undefined;
    const passWithoutStage = r.registrationId === null && r.seasonPassId !== null;
    if (passWithoutStage) {
      if (f.scope.kind !== 'event' && inScope(f.scope, undefined, r.seasonPass?.seasonId)) {
        unassigned.amount = round(unassigned.amount + Number(r.amount));
        unassigned.count += 1;
      }
      continue;
    }
    if (!inScope(f.scope, e, r.seasonPass?.seasonId)) continue;
    const amount = Number(r.amount);
    refundSum = round(refundSum + amount);
    refundCount += 1;
    const key = r.percent === 100 ? '100' : r.percent === 50 ? '50' : r.percent === 0 ? '0' : 'other';
    byPercent[key].amount = round(byPercent[key].amount + amount);
    byPercent[key].count += 1;
    const day = ymdInTz(r.createdAt);
    refundByDay.set(day, round((refundByDay.get(day) ?? 0) + amount));
    csv.push({
      date: r.createdAt.toISOString(),
      type: 'Возврат',
      participant: fullName(r.user),
      telegram: r.user.username ? `@${r.user.username}` : String(r.user.telegramId ?? ''),
      event: e?.title ?? (r.seasonPass ? `Абонемент «${r.seasonPass.season.title}»` : ''),
      distance: r.registration?.distance?.label ?? '',
      kind: r.seasonPassId ? 'Абонемент' : 'Старт',
      amount,
      share: null,
      discount: null,
      promoCode: null,
      percent: r.percent,
      status: r.confirmedAt ? 'Возврат подтверждён ApiPay' : r.source === 'APIPAY' ? 'Возврат из ApiPay' : 'Оформлен в админке, ждёт подтверждения ApiPay',
      invoice: r.payment?.providerInvoiceId ? String(r.payment.providerInvoiceId) : '',
    });
  }
  csv.sort((a, b) => a.date.localeCompare(b.date));

  // ---------- Отмены ----------
  // Несостоявшиеся счета: истёк, отменён, ошибка — по дате выставления.
  const failed = await prisma.payment.findMany({
    where: { state: { in: ['EXPIRED', 'CANCELLED', 'FAILED'] }, ...(paidAt ? { createdAt: paidAt } : {}) },
    select: {
      state: true,
      amount: true,
      seasonPass: { select: { seasonId: true, registrations: { select: { eventId: true } } } },
      registration: { select: { eventId: true } },
    },
  });
  const unpaid = { EXPIRED: 0, CANCELLED: 0, FAILED: 0 } as Record<'EXPIRED' | 'CANCELLED' | 'FAILED', number>;
  for (const p of failed) {
    const evIds = p.registration ? [p.registration.eventId] : (p.seasonPass?.registrations ?? []).map((r) => r.eventId);
    const ok =
      f.scope.kind === 'all' ||
      (f.scope.kind === 'season' && (p.seasonPass?.seasonId === f.scope.seasonId || evIds.some((id) => eventById.get(id)?.seasonId === (f.scope as { seasonId: number }).seasonId))) ||
      (f.scope.kind === 'event' && evIds.includes(f.scope.eventId));
    if (ok) unpaid[p.state as 'EXPIRED' | 'CANCELLED' | 'FAILED'] += 1;
  }
  // Записи, отменённые без возврата (организатором или участником). Даты отмены
  // в базе нет — период по дате записи.
  const regWhere: Prisma.RegistrationWhereInput = {
    paymentStatus: 'CANCELLED',
    refundedAt: null,
    ...(paidAt ? { registeredAt: paidAt } : {}),
    ...(f.scope.kind === 'event' ? { eventId: f.scope.eventId } : f.scope.kind === 'season' ? { event: { seasonId: f.scope.seasonId } } : {}),
  };
  const cancelledRegs = await prisma.registration.findMany({ where: regWhere, select: { id: true, payments: { select: { state: true } }, seasonPass: { select: { payments: { select: { state: true } } } } } });
  // Только те, где была оплата: неоплаченные счета уже посчитаны выше.
  const cancelledPaid = cancelledRegs.filter((r) => [...r.payments, ...(r.seasonPass?.payments ?? [])].some((p) => p.state === 'PAID')).length;

  // ---------- График ----------
  const days = [...new Set([...byDay.keys(), ...refundByDay.keys()])].sort();
  const chart = days.map((d) => ({ day: d, amount: byDay.get(d)?.amount ?? 0, count: byDay.get(d)?.count ?? 0, refunds: refundByDay.get(d) ?? 0 }));

  // ---------- Заполненность ----------
  const fillEvents = await prisma.event.findMany({
    where: f.scope.kind === 'event' ? { id: f.scope.eventId } : f.scope.kind === 'season' ? { seasonId: f.scope.seasonId } : {},
    orderBy: { date: 'asc' },
    select: {
      id: true,
      title: true,
      date: true,
      slotsTotal: true,
      slotsTaken: true,
      distances: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, label: true, slotsTotal: true, slotsTaken: true } },
    },
  });
  const paidRegs = await prisma.registration.groupBy({
    by: ['eventId', 'distanceId'],
    where: { eventId: { in: fillEvents.map((e) => e.id) }, paymentStatus: 'PAID' },
    _count: { _all: true },
  });
  const paidOf = (eventId: number, distanceId: number | null) =>
    paidRegs.filter((r) => r.eventId === eventId && (distanceId === null || r.distanceId === distanceId)).reduce((s, r) => s + r._count._all, 0);
  const fill = fillEvents.map((e) => ({
    eventId: e.id,
    title: e.title,
    date: e.date,
    total: e.distances.length ? e.distances.reduce((s, d) => s + d.slotsTotal, 0) : e.slotsTotal,
    taken: e.distances.length ? e.distances.reduce((s, d) => s + d.slotsTaken, 0) : e.slotsTaken,
    paid: paidOf(e.id, null),
    distances: e.distances.map((d) => ({ label: d.label, total: d.slotsTotal, taken: d.slotsTaken, paid: paidOf(e.id, d.id) })),
  }));

  // ---------- Промокоды ----------
  const redemptions = await prisma.promoRedemption.findMany({
    where: { status: 'USED', ...(paidAt ? { createdAt: paidAt } : {}) },
    include: { promoCode: { select: { id: true, code: true, kind: true, value: true } } },
  });
  const regIds = redemptions.map((r) => r.registrationId).filter((x): x is number => x !== null);
  const passIds = redemptions.map((r) => r.seasonPassId).filter((x): x is number => x !== null);
  const redRegs = new Map((await prisma.registration.findMany({ where: { id: { in: regIds } }, select: { id: true, eventId: true } })).map((r) => [r.id, r.eventId]));
  const redPasses = new Map(
    (await prisma.seasonPass.findMany({ where: { id: { in: passIds } }, select: { id: true, seasonId: true, registrations: { select: { eventId: true } } } })).map((p) => [p.id, p]),
  );
  const promoMap = new Map<number, { code: string; kind: string; value: number; uses: number; discount: number }>();
  for (const r of redemptions) {
    let ok: boolean;
    if (r.paymentId !== null && payments.some((p) => p.id === r.paymentId)) ok = paymentInScope.has(r.paymentId);
    else if (r.registrationId !== null) ok = inScope(f.scope, eventById.get(redRegs.get(r.registrationId) ?? 0));
    else if (r.seasonPassId !== null) {
      const pass = redPasses.get(r.seasonPassId);
      ok =
        f.scope.kind === 'all' ||
        (f.scope.kind === 'season' && pass?.seasonId === f.scope.seasonId) ||
        (f.scope.kind === 'event' && (pass?.registrations ?? []).some((x) => x.eventId === (f.scope as { eventId: number }).eventId));
    } else ok = f.scope.kind === 'all';
    if (!ok) continue;
    const m = promoMap.get(r.promoCode.id) ?? { code: r.promoCode.code, kind: r.promoCode.kind, value: r.promoCode.value, uses: 0, discount: 0 };
    m.uses += 1;
    m.discount = round(m.discount + Number(r.discount));
    promoMap.set(r.promoCode.id, m);
  }
  const promos = [...promoMap.values()].sort((a, b) => b.uses - a.uses || a.code.localeCompare(b.code));

  return {
    filter: f,
    paid: { amount: round(paidSum), count: paidCount, single: { amount: round(singleSum), count: singleCount } },
    passes: { amount: round(passSum), count: passCount },
    refunds: { amount: refundSum, count: refundCount, byPercent, unassigned },
    cancellations: { unpaidInvoices: unpaid, cancelledWithoutRefund: cancelledPaid },
    revenue: round(paidSum - refundSum),
    chart,
    fill,
    promos,
    csv,
  };
}
