import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getEvents, getFinance, getSeasons, type AdminEvent, type FinanceReport, type SeasonOption } from './api';
import { downloadCsv } from './exportCsv';
import { formatDate, formatDateTime, priceFmt } from './helpers';

/**
 * «Финансы» (2026-11-12): только просмотр — суммы из базы по фильтру
 * (всё / сезон / старт + период). Ничего не меняет.
 */

type ScopeKind = 'all' | 'season' | 'event';
const money = (n: number) => `${priceFmt.format(n)} ₸`;

function Stat({ title, value, hint }: { title: string; value: string; hint?: ReactNode }) {
  return (
    <div className="ad-fin__stat">
      <span className="ad-fin__label">{title}</span>
      <b className="ad-fin__value">{value}</b>
      {hint && <span className="ad-hint">{hint}</span>}
    </div>
  );
}

/** Столбики продаж по дням; без библиотек. */
function SalesChart({ data }: { data: FinanceReport['chart'] }) {
  if (data.length === 0) return <p className="ad-hint">За выбранный период продаж не было.</p>;
  const max = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div className="ad-fin__chart" role="img" aria-label="Продажи по дням">
      {data.map((d) => (
        <div key={d.day} className="ad-fin__bar-col" title={`${d.day.split('-').reverse().join('.')}: ${money(d.amount)}, оплат: ${d.count}${d.refunds ? `, возвраты ${money(d.refunds)}` : ''}`}>
          <span className="ad-fin__bar-val">{d.amount > 0 ? priceFmt.format(d.amount) : ''}</span>
          <div className="ad-fin__bar" style={{ height: `${Math.max((d.amount / max) * 100, d.amount > 0 ? 2 : 0)}%` }} />
          <span className="ad-fin__bar-day">{d.day.slice(8)}.{d.day.slice(5, 7)}</span>
        </div>
      ))}
    </div>
  );
}

function Fill({ total, taken, paid }: { total: number; taken: number; paid: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((taken / total) * 100)) : 0;
  return (
    <div className="ad-fin__fill">
      <div className="ad-fin__fill-track">
        <div className="ad-fin__fill-bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="ad-nowrap">
        {taken} из {total} ({pct}%) · оплачено {paid}
      </span>
    </div>
  );
}

const CSV_HEAD = ['Дата', 'Тип', 'Участник', 'Telegram', 'Старт', 'Дистанция', 'Что оплачено', 'Сумма, ₸', 'Доля старта, ₸', 'Скидка, ₸', 'Промокод', 'Процент возврата', 'Статус', 'Счёт Kaspi (ApiPay)'];

export default function FinanceSection() {
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [kind, setKind] = useState<ScopeKind>('season');
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [s, e] = await Promise.all([getSeasons(), getEvents()]);
        setSeasons(s);
        setEvents(e);
        setSeasonId((s.find((x) => x.isActive) ?? s[0])?.id ?? null);
        setEventId(e[0]?.id ?? null);
        if (s.length === 0) setKind('all');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить сезоны');
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (kind === 'season' && !seasonId) return;
    if (kind === 'event' && !eventId) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await getFinance({ scope: kind, seasonId, eventId, from: from || null, to: to || null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  }, [kind, seasonId, eventId, from, to]);

  useEffect(() => {
    // Пересчёт при смене фильтра — синхронизация с API, ради неё эффект и нужен.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const scopeTitle = useMemo(() => {
    if (kind === 'season') return seasons.find((s) => s.id === seasonId)?.title ?? 'Сезон';
    if (kind === 'event') return events.find((e) => e.id === eventId)?.title ?? 'Старт';
    return 'Все продажи';
  }, [kind, seasonId, eventId, seasons, events]);

  const exportCsv = () => {
    if (!report) return;
    const rows = report.csv.map((r) => [
      formatDateTime(r.date),
      r.type,
      r.participant,
      r.telegram,
      r.event,
      r.distance,
      r.kind,
      r.type === 'Возврат' ? -r.amount : r.amount,
      r.share,
      r.discount,
      r.promoCode,
      r.percent === null ? null : `${r.percent}%`,
      r.status,
      r.invoice,
    ]);
    const period = [from, to].filter(Boolean).join('_');
    downloadCsv([CSV_HEAD, ...rows], `finansy-${kind === 'all' ? 'vse' : kind === 'season' ? `sezon-${seasonId}` : `start-${eventId}`}${period ? `-${period}` : ''}.csv`);
  };

  const r = report;
  const bp = r?.refunds.byPercent;

  return (
    <section className="ad-section">
      <header className="ad-section__head">
        <h2>Финансы</h2>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Считаем…' : 'Обновить'}
          </button>
          <button type="button" className="ad-btn ad-btn--primary" onClick={exportCsv} disabled={!r || r.csv.length === 0}>
            Скачать CSV для Excel
          </button>
        </div>
      </header>

      <div className="ad-card ad-fin__filter">
        <label>
          Что считать
          <select value={kind} onChange={(e) => setKind(e.target.value as ScopeKind)}>
            <option value="season">Сезон целиком</option>
            <option value="event">Один старт</option>
            <option value="all">Все продажи</option>
          </select>
        </label>
        {kind === 'season' && (
          <label>
            Сезон
            <select value={seasonId ?? ''} onChange={(e) => setSeasonId(Number(e.target.value))}>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === 'event' && (
          <label>
            Старт
            <select value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {formatDate(e.date)} — {e.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Период с
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          по
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button type="button" className="ad-btn" onClick={() => { setFrom(''); setTo(''); }}>
            Весь период
          </button>
        )}
      </div>

      {error && <p className="ad-msg ad-msg--error">{error}</p>}

      {r && (
        <>
          <p className="ad-hint">
            {scopeTitle}
            {from || to ? ` · ${from ? `с ${from.split('-').reverse().join('.')}` : ''}${to ? ` по ${to.split('-').reverse().join('.')}` : ''}` : ' · весь период'}. Оплаты — по дате оплаты, возвраты — по дате оформления, по времени Астаны.
          </p>

          <div className="ad-fin__stats">
            <Stat
              title="Оплачено"
              value={money(r.paid.amount)}
              hint={`${r.paid.count} оплат · старты ${money(r.paid.single.amount)} (${r.paid.single.count})`}
            />
            <Stat
              title="Возвраты"
              value={money(r.refunds.amount)}
              hint={
                <>
                  {r.refunds.count} шт. · 100%: {money(bp!['100'].amount)} ({bp!['100'].count}) · 50%: {money(bp!['50'].amount)} ({bp!['50'].count}) · 0%: {bp!['0'].count}
                  {bp!.other.count > 0 && ` · из ApiPay: ${money(bp!.other.amount)} (${bp!.other.count})`}
                </>
              }
            />
            <Stat
              title="Отмены"
              value={String(r.cancellations.cancelledWithoutRefund + r.cancellations.unpaidInvoices.EXPIRED + r.cancellations.unpaidInvoices.CANCELLED + r.cancellations.unpaidInvoices.FAILED)}
              hint={`Отменено без возврата: ${r.cancellations.cancelledWithoutRefund} · неоплаченные счета: истекли ${r.cancellations.unpaidInvoices.EXPIRED}, отменены ${r.cancellations.unpaidInvoices.CANCELLED}, ошибка ${r.cancellations.unpaidInvoices.FAILED}`}
            />
            <Stat title="Выручка" value={money(r.revenue)} hint="Оплачено − возвраты" />
          </div>

          {r.refunds.unassigned.count > 0 && (
            <p className="ad-msg ad-msg--error">
              Возвраты абонементов из ApiPay без этапа: {money(r.refunds.unassigned.amount)} ({r.refunds.unassigned.count}). В суммы не вошли — отметьте этапы в «Участниках» → «Оформить возврат».
            </p>
          )}

          <div className="ad-card">
            <h3>Абонементы</h3>
            <p>
              <b>{r.passes.count}</b> оплат на <b>{money(r.passes.amount)}</b>
            </p>
            <p className="ad-hint">
              {kind === 'event'
                ? 'Доля этого старта: стоимость абонемента, делённая на число его стартов. Она уже входит в «Оплачено» и «Выручку».'
                : 'Входят в «Оплачено» и «Выручку» полной суммой.'}
            </p>
          </div>

          <div className="ad-card">
            <h3>Продажи по дням</h3>
            <SalesChart data={r.chart} />
          </div>

          <div className="ad-card">
            <h3>Заполненность</h3>
            {r.fill.length === 0 ? (
              <p className="ad-hint">Стартов нет.</p>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Старт / дистанция</th>
                      <th>Занято из лимита</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.fill.map((e) => (
                      <FillRows key={e.eventId} e={e} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ad-hint">«Занято» — места за оплаченными и ждущими оплаты записями; «оплачено» — только оплаченные.</p>
          </div>

          <div className="ad-card">
            <h3>Промокоды</h3>
            {r.promos.length === 0 ? (
              <p className="ad-hint">Промокоды не использовались.</p>
            ) : (
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <thead>
                    <tr>
                      <th>Код</th>
                      <th>Скидка</th>
                      <th>Использований</th>
                      <th>Сумма скидок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.promos.map((p) => (
                      <tr key={p.code}>
                        <td className="ad-nowrap">{p.code}</td>
                        <td>{p.kind === 'PERCENT' ? `${p.value}%` : money(p.value)}</td>
                        <td>{p.uses}</td>
                        <td className="ad-nowrap">{money(p.discount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="ad-hint">Только оплаченные использования (и бесплатные регистрации по коду на 100%).</p>
          </div>
        </>
      )}
    </section>
  );
}

function FillRows({ e }: { e: FinanceReport['fill'][number] }) {
  return (
    <>
      <tr>
        <td>
          <b>{e.title}</b> <span className="ad-hint">{formatDate(e.date)}</span>
        </td>
        <td>
          <Fill total={e.total} taken={e.taken} paid={e.paid} />
        </td>
      </tr>
      {e.distances.length > 1 &&
        e.distances.map((d) => (
          <tr key={d.label}>
            <td className="ad-fin__sub">{d.label}</td>
            <td>
              <Fill total={d.total} taken={d.taken} paid={d.paid} />
            </td>
          </tr>
        ))}
    </>
  );
}
