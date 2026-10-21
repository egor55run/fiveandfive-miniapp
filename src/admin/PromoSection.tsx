import { Fragment, useEffect, useState } from 'react';
import {
  AdminApiError,
  createPromoCode,
  getEvents,
  getPromoCodes,
  updatePromoCode,
  type AdminEvent,
  type PromoCode,
  type PromoInput,
} from './api';
import { formatDate, formatDateTime, toDateTimeLocal } from './helpers';

/**
 * Промокоды: создание, правка, выключение и кто какой код использовал.
 * Правила (lib/promo на бэке): один раз на человека; код старта — только на
 * этот старт, код серии — на любой старт и абонемент; использование
 * засчитывается при выставлении счёта и возвращается, если счёт не оплатили.
 */

type Form = {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  maxUses: string;
  validFrom: string;
  validUntil: string;
  eventId: string; // '' — вся серия
  active: boolean;
  note: string;
};

const EMPTY: Form = { code: '', kind: 'PERCENT', value: '10', maxUses: '', validFrom: '', validUntil: '', eventId: '', active: true, note: '' };

const STATUS: Record<string, string> = { HELD: 'счёт выставлен', USED: 'оплачено', RELEASED: 'не оплатили' };

function toInput(f: Form): PromoInput | string {
  const value = Number(f.value);
  if (!f.code.trim()) return 'Укажите код';
  if (!Number.isInteger(value) || value < 1) return 'Скидка — целое число больше нуля';
  if (f.kind === 'PERCENT' && value > 100) return 'Скидка в процентах — не больше 100';
  const maxUses = f.maxUses.trim() === '' ? null : Number(f.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return 'Лимит — целое число или пусто';
  if (f.validFrom && f.validUntil && new Date(f.validFrom) >= new Date(f.validUntil)) return '«Действует с» должно быть раньше «до»';
  return {
    code: f.code.trim().toUpperCase(),
    kind: f.kind,
    value,
    maxUses,
    validFrom: f.validFrom ? new Date(f.validFrom).toISOString() : null,
    validUntil: f.validUntil ? new Date(f.validUntil).toISOString() : null,
    eventId: f.eventId === '' ? null : Number(f.eventId),
    active: f.active,
    note: f.note.trim() || null,
  };
}

const discountText = (p: Pick<PromoCode, 'kind' | 'value'>) =>
  p.kind === 'PERCENT' ? `−${p.value}%` : `−${p.value.toLocaleString('ru-RU')} ₸`;

export default function PromoSection() {
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [c, e] = await Promise.all([getPromoCodes(), getEvents()]);
      setCodes(c);
      setEvents(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить промокоды');
    }
  };

  useEffect(() => {
    // Загрузка при открытии раздела — синхронизация с API, ради неё эффект и нужен.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const edit = (c: PromoCode) => {
    setEditingId(c.id);
    setForm({
      code: c.code,
      kind: c.kind,
      value: String(c.value),
      maxUses: c.maxUses === null ? '' : String(c.maxUses),
      validFrom: c.validFrom ? toDateTimeLocal(c.validFrom) : '',
      validUntil: c.validUntil ? toDateTimeLocal(c.validUntil) : '',
      eventId: c.eventId === null ? '' : String(c.eventId),
      active: c.active,
      note: c.note ?? '',
    });
    setError(null);
  };

  const save = async () => {
    if (!form) return;
    const input = toInput(form);
    if (typeof input === 'string') {
      setError(input);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId === null) await createPromoCode(input);
      else await updatePromoCode(editingId, input);
      setNotice(editingId === null ? `Промокод ${input.code} создан` : `Промокод ${input.code} сохранён`);
      setForm(null);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError || err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: PromoCode) => {
    setError(null);
    try {
      await updatePromoCode(c.id, {
        code: c.code,
        kind: c.kind,
        value: c.value,
        maxUses: c.maxUses,
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        eventId: c.eventId,
        active: !c.active,
        note: c.note,
      });
      setNotice(`${c.code}: ${c.active ? 'выключен' : 'включён'}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  };

  return (
    <section className="ad-section">
      <header className="ad-section__head">
        <h2>Промокоды</h2>
        <div className="ad-actions">
          <button type="button" className="ad-btn" onClick={() => void load()}>
            Обновить
          </button>
          <button
            type="button"
            className="ad-btn ad-btn--primary"
            onClick={() => {
              setEditingId(null);
              setForm({ ...EMPTY });
              setError(null);
            }}
          >
            + Новый промокод
          </button>
        </div>
      </header>

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}

      {form && (
        <div className="ad-card">
          <h3>{editingId === null ? 'Новый промокод' : `Правка: ${form.code}`}</h3>
          <div className="ad-form">
            <label>
              <span>Код</span>
              <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="RUN10" maxLength={40} />
              <span className="ad-hint ad-hint--dim">Буквы, цифры, «-» и «_». Регистр не важен.</span>
            </label>
            <label>
              <span>Скидка</span>
              <span className="ad-nowrap">
                <input type="number" min="1" className="ad-input--num" value={form.value} onChange={(e) => set('value', e.target.value)} />{' '}
                <select value={form.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}>
                  <option value="PERCENT">%</option>
                  <option value="FIXED">₸</option>
                </select>
              </span>
              <span className="ad-hint ad-hint--dim">100% — регистрация бесплатно, без счёта в Kaspi.</span>
            </label>
            <label>
              <span>Действует на</span>
              <select value={form.eventId} onChange={(e) => set('eventId', e.target.value)}>
                <option value="">Всю серию (любой старт и абонемент)</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title} — {formatDate(e.date)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Лимит использований</span>
              <input type="number" min="1" value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} placeholder="без лимита" />
              <span className="ad-hint ad-hint--dim">Один человек — один раз, независимо от лимита.</span>
            </label>
            <label>
              <span>Действует с</span>
              <input type="datetime-local" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
            </label>
            <label>
              <span>Действует до</span>
              <input type="datetime-local" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
            </label>
            <label>
              <span>Заметка</span>
              <input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="для кого: партнёр, блогер…" maxLength={200} />
            </label>
            <label>
              <span>Включён</span>
              <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            </label>
          </div>
          <div className="ad-actions">
            <button type="button" className="ad-btn ad-btn--primary" disabled={busy} onClick={() => void save()}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
            <button type="button" className="ad-btn" disabled={busy} onClick={() => setForm(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {codes.length === 0 ? (
        <p className="ad-msg">Промокодов пока нет</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>Код</th>
                <th>Скидка</th>
                <th>Где</th>
                <th className="num">Использовано</th>
                <th>Срок</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <Fragment key={c.id}>
                  <tr className={c.active ? undefined : 'ad-row--muted'}>
                    <td>
                      <b>{c.code}</b>
                      {c.note && <div className="ad-hint ad-hint--dim">{c.note}</div>}
                    </td>
                    <td className="ad-nowrap">{discountText(c)}</td>
                    <td>{c.event ? `${c.event.title}, ${formatDate(c.event.date)}` : 'Вся серия'}</td>
                    <td className="num">
                      {c.used}
                      {c.maxUses !== null ? ` / ${c.maxUses}` : ''}
                    </td>
                    <td className="ad-nowrap">
                      {c.validFrom ? `с ${formatDateTime(c.validFrom)}` : ''}
                      {c.validFrom && c.validUntil ? <br /> : ''}
                      {c.validUntil ? `до ${formatDateTime(c.validUntil)}` : !c.validFrom ? 'бессрочно' : ''}
                    </td>
                    <td>{c.active ? 'включён' : 'выключен'}</td>
                    <td className="ad-nowrap">
                      <button type="button" className="ad-btn ad-btn--sm" onClick={() => edit(c)}>
                        Правка
                      </button>
                      <button type="button" className="ad-btn ad-btn--sm" onClick={() => void toggle(c)}>
                        {c.active ? 'Выключить' : 'Включить'}
                      </button>
                      <button
                        type="button"
                        className="ad-btn ad-btn--sm"
                        disabled={c.redemptions.length === 0}
                        onClick={() => setOpenId(openId === c.id ? null : c.id)}
                      >
                        Кто использовал ({c.redemptions.length})
                      </button>
                    </td>
                  </tr>
                  {openId === c.id && (
                    <tr>
                      <td colSpan={7}>
                        <table className="ad-table">
                          <thead>
                            <tr>
                              <th>Когда</th>
                              <th>Кто</th>
                              <th>Что</th>
                              <th className="num">Цена</th>
                              <th className="num">Скидка</th>
                              <th className="num">Итог</th>
                              <th>Статус</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.redemptions.map((r) => (
                              <tr key={r.id} className={r.status === 'RELEASED' ? 'ad-row--muted' : undefined}>
                                <td className="ad-nowrap">{formatDateTime(r.at)}</td>
                                <td>
                                  {r.who}
                                  {r.username && <div className="ad-hint ad-hint--dim">@{r.username}</div>}
                                </td>
                                <td>{r.target}</td>
                                <td className="num">{r.base.toLocaleString('ru-RU')} ₸</td>
                                <td className="num">−{r.discount.toLocaleString('ru-RU')} ₸</td>
                                <td className="num">{r.total.toLocaleString('ru-RU')} ₸</td>
                                <td>{STATUS[r.status]}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="ad-hint">
            «Использовано» — выставленные и оплаченные счета; если счёт не оплатили, использование вернулось в лимит.
          </p>
        </div>
      )}
    </section>
  );
}
