import { useCallback, useEffect, useState } from 'react';
import {
  getAdminSettings,
  getEvents,
  getFaq,
  getSeasons,
  saveFaq,
  updateAdminSettings,
  type AdminEvent,
  type AdminSettings,
  type FaqItem,
  type SeasonOption,
} from './api';
import { priceFmt } from './helpers';
import SeasonPassCard from './SeasonPassCard';

/**
 * «Настройки» (2026-11-10): то, что раньше включалось через код или .env.
 * Всё применяется сразу, без выкладки; изменённые страницы сайта через минуту
 * уходят в Яндекс и Bing (IndexNow).
 */

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ad-set__toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{label}</b>
        <span className="ad-hint">{hint}</span>
      </span>
    </label>
  );
}

function NumberField({ label, hint, value, disabled, onSave }: { label: string; hint: string; value: number; disabled: boolean; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const valid = Number.isInteger(n) && n > 0;
  return (
    <label className="ad-set__num">
      <span><b>{label}</b></span>
      <span className="ad-nowrap">
        <input type="number" min={1} className="ad-input--num" value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="ad-btn" disabled={disabled || !valid || n === value} onClick={() => onSave(n)}>
          Сохранить
        </button>
      </span>
      <span className="ad-hint ad-hint--dim">{hint}</span>
    </label>
  );
}

// ---------- Вопросы: ответ в поле — абзацы через пустую строку, пункты списка начинаются с «- » ----------

const toText = (a: FaqItem['a']) =>
  a.map((b) => (typeof b === 'string' ? b : b.list.map((l) => `- ${l}`).join('\n'))).join('\n\n');

function fromText(text: string): FaqItem['a'] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
      return lines.every((l) => l.startsWith('- ')) ? { list: lines.map((l) => l.slice(2).trim()) } : lines.join(' ');
    });
}

type Draft = { id: string; q: string; text: string };

function FaqEditor() {
  const [items, setItems] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getFaq()
      .then((r) => setItems(r.items.map((i) => ({ id: i.id, q: i.q, text: toText(i.a) }))))
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить вопросы'));
  }, []);

  if (!items) return <p className="ad-msg">{error ?? 'Загружаем вопросы…'}</p>;

  const update = (i: number, patch: Partial<Draft>) => {
    setNotice(null);
    setItems(items.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setItems(next);
  };
  const add = () => {
    let n = items.length + 1;
    while (items.some((it) => it.id === `q${n}`)) n++;
    setItems([...items, { id: `q${n}`, q: '', text: '' }]);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveFaq(items.map((it) => ({ id: it.id, q: it.q.trim(), a: fromText(it.text) })));
      setItems(r.items.map((i) => ({ id: i.id, q: i.q, text: toText(i.a) })));
      setNotice('Сохранено. Новые ответы уже на сайте и в боте.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ad-card">
      <h3>Частые вопросы</h3>
      <p className="ad-hint">
        Те же ответы — на сайте (страница «Вопросы») и в боте (кнопка «Задать вопрос»). В ответе: абзацы разделяйте пустой
        строкой; пункты списка начинайте с «- »; ссылка — [текст](/адрес).
      </p>
      <ol className="ad-faq">
        {items.map((it, i) => (
          <li key={it.id} className="ad-faq__item">
            <input value={it.q} placeholder="Вопрос" disabled={busy} onChange={(e) => update(i, { q: e.target.value })} />
            <textarea rows={4} value={it.text} placeholder="Ответ" disabled={busy} onChange={(e) => update(i, { text: e.target.value })} />
            <div className="ad-actions">
              <button type="button" className="ad-btn ad-btn--sm" disabled={busy || i === 0} onClick={() => move(i, -1)}>Выше</button>
              <button type="button" className="ad-btn ad-btn--sm" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>Ниже</button>
              <button
                type="button"
                className="ad-btn ad-btn--sm"
                disabled={busy}
                onClick={() => window.confirm(`Удалить вопрос «${it.q}»?`) && setItems(items.filter((_, n) => n !== i))}
              >
                Удалить
              </button>
              <span className="ad-hint ad-hint--dim">код: {it.id}</span>
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}
      <div className="ad-actions">
        <button type="button" className="ad-btn" disabled={busy} onClick={add}>+ Вопрос</button>
        <button type="button" className="ad-btn ad-btn--primary" disabled={busy} onClick={() => void save()}>Сохранить вопросы</button>
      </div>
      <p className="ad-hint ad-hint--dim">
        Бот отвечает по темам из вопросов с кодами register, season-pass, fee, refund, transfer, age, bring, cloakroom — их лучше
        не удалять, а править текст.
      </p>
    </section>
  );
}

export default function SettingsSection() {
  const [s, setS] = useState<AdminSettings | null>(null);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [st, se, ev] = await Promise.all([getAdminSettings(), getSeasons(), getEvents()]);
      setS(st);
      setSeasons(se);
      // Только будущие старты — их цены и меняют.
      const now = Date.now();
      setEvents(ev.filter((e) => Date.parse(e.date) > now));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить');
    }
  }, []);

  useEffect(() => {
    // Загрузка при открытии раздела.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const change = async (patch: Partial<AdminSettings>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setS(await updateAdminSettings(patch));
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <p className="ad-msg">{error ?? 'Загружаем…'}</p>;

  const confirmToggle = (text: string) => window.confirm(text);
  const upcoming = events;

  return (
    <>
      <section className="ad-card">
        <h3>Главное</h3>
        <p className="ad-hint">Изменения применяются сразу — без выкладки. Поисковики получат изменённые страницы через минуту.</p>

        <Toggle
          label="Регистрация открыта"
          hint={
            s.registrationOpen && !s.paymentConfigured
              ? 'Включено, но оплата Kaspi (ApiPay) не подключена — участники всё ещё видят «Регистрация скоро откроется». Как только оплату подключат, регистрация откроется сама.'
              : 'Участники могут записываться на старты и покупать абонемент. Администраторы могут записаться и при выключенной — для тестового платежа.'
          }
          checked={s.registrationOpen}
          disabled={busy}
          onChange={(v) =>
            confirmToggle(v ? 'Открыть регистрацию для всех?' : 'Закрыть регистрацию? Новые записи станут недоступны.') &&
            void change({ registrationOpen: v }, v ? 'Регистрация открыта.' : 'Регистрация закрыта.')
          }
        />
        <p className={`ad-msg ${s.registrationEffective ? 'ad-msg--ok' : ''}`}>
          Сейчас у участников: {s.registrationEffective ? 'регистрация идёт' : '«Регистрация скоро откроется»'}
          {s.registrationOpenedAt ? ` · последнее открытие ${new Date(s.registrationOpenedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}` : ''}
          {!s.paymentConfigured ? ' · оплата не подключена' : ''}
        </p>

        <Toggle
          label="Показывать цены"
          hint="Сразу везде: сайт, приложение, бот и разметка для Google и Яндекса. Выключено — вместо суммы «Цена будет объявлена». Сумму к оплате участник видит всегда — на шаге оплаты."
          checked={s.pricesPublic}
          disabled={busy}
          onChange={(v) =>
            confirmToggle(v ? 'Показать цены на сайте, в приложении и в боте?' : 'Скрыть цены? Вместо них будет «Цена будет объявлена».') &&
            void change({ pricesPublic: v }, v ? 'Цены показаны.' : 'Цены скрыты.')
          }
        />
        {s.registrationOpen && !s.pricesPublic && (
          <p className="ad-msg ad-msg--error">Регистрация открыта, а цены скрыты: участник узнает сумму только на шаге оплаты.</p>
        )}
        {error && <p className="ad-msg ad-msg--error">{error}</p>}
        {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}
      </section>

      <section className="ad-card">
        <h3>Цены</h3>
        <p className="ad-hint">Цена одного старта — у его дистанций: раздел «Старты» → «Изменить» → «Дистанции».</p>
        <table className="ad-table">
          <thead>
            <tr><th>Старт</th><th>Дистанция</th><th>Цена</th></tr>
          </thead>
          <tbody>
            {upcoming.flatMap((e) =>
              e.distances.map((d, i) => (
                <tr key={`${e.id}-${d.id}`}>
                  <td>{i === 0 ? e.title : ''}</td>
                  <td>{d.label}</td>
                  <td>{priceFmt.format(d.price)} ₸</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </section>

      {seasons
        .filter((x) => x.isActive)
        .map((x) => (
          <SeasonPassCard key={x.id} season={x} onSaved={(saved) => setSeasons((prev) => prev.map((y) => (y.id === saved.id ? saved : y)))} />
        ))}

      <section className="ad-card">
        <h3>Лимиты</h3>
        <NumberField
          label="Счетов Kaspi в день"
          hint={`Сколько счетов ApiPay выставляет за сутки по вашему тарифу. Сегодня выставлено: ${s.invoicesToday}. Когда лимит выбран, участник видит «попробуйте позже», а вам приходит сообщение.`}
          value={s.invoiceDailyLimit}
          disabled={busy}
          onSave={(v) => void change({ invoiceDailyLimit: v, invoiceDailyWarn: Math.min(s.invoiceDailyWarn, v) }, 'Лимит счетов сохранён.')}
        />
        <NumberField
          label="Предупредить, когда счетов за день"
          hint="На этом числе вам придёт сообщение в Telegram, что лимит скоро кончится."
          value={s.invoiceDailyWarn}
          disabled={busy}
          onSave={(v) => void change({ invoiceDailyWarn: v }, 'Порог сохранён.')}
        />
        <NumberField
          label="Писем в сутки"
          hint="По тарифу Brevo (бесплатный — 300, ставим чуть меньше). Что не влезло — уйдёт на следующий день."
          value={s.emailDailyLimit}
          disabled={busy}
          onSave={(v) => void change({ emailDailyLimit: v }, 'Лимит писем сохранён.')}
        />
      </section>

      <section className="ad-card">
        <h3>Где ещё что меняется</h3>
        <ul className="ad-hint">
          <li>Дата, время, место, программа дня, выдача пакетов, номера, карты трасс, Положение, оформление — «Старты» → «Изменить».</li>
          <li>Закрытие регистрации на старт — там же, поле «Регистрация закрывается».</li>
          <li>Промокоды — «Промокоды». Рассылки — «Рассылки».</li>
        </ul>
      </section>

      <FaqEditor />
    </>
  );
}
