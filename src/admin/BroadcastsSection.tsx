import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assetUrl,
  cancelBroadcast,
  createBroadcast,
  deleteBroadcast,
  deleteBroadcastPhoto,
  getBroadcastAudience,
  getBroadcasts,
  ROUTE_IMAGE_ACCEPT,
  ROUTE_IMAGE_MAX_BYTES,
  sendBroadcast,
  testBroadcast,
  updateBroadcast,
  uploadBroadcastPhoto,
  type Broadcast,
  type BroadcastAudience,
  type BroadcastDraft,
  type BroadcastStats,
} from './api';

/**
 * «Рассылки» (2026-10-28): сообщение с оформлением, картинкой и кнопкой →
 * тест себе → отправка аудитории очередью на сервере. Под каждой рассылкой бот
 * сам добавляет кнопку «Не присылать новости».
 */

type EventOption = { id: number; title: string; date: string };

const AUDIENCE_LABELS: Record<BroadcastAudience, string> = {
  ALL: 'Все пользователи бота',
  EVENT: 'Записанные на старт',
  PASS: 'С абонементом',
  NO_REG: 'Без регистрации',
};

const STATUS_LABELS: Record<Broadcast['status'], string> = {
  DRAFT: 'Черновик',
  SENDING: 'Отправляется',
  DONE: 'Отправлена',
  CANCELLED: 'Остановлена',
};

const EMPTY: BroadcastDraft = { text: '', buttonKind: null, buttonText: null, buttonUrl: null, audience: 'ALL', eventId: null };

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' });
const eventDateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' });

const draftOf = (b: Broadcast): BroadcastDraft => ({
  text: b.text,
  buttonKind: b.buttonKind,
  buttonText: b.buttonText,
  buttonUrl: b.buttonUrl,
  audience: b.audience,
  eventId: b.eventId,
});

const sameDraft = (a: BroadcastDraft, b: BroadcastDraft) =>
  a.text === b.text &&
  a.buttonKind === b.buttonKind &&
  (a.buttonText ?? '') === (b.buttonText ?? '') &&
  (a.buttonUrl ?? '') === (b.buttonUrl ?? '') &&
  a.audience === b.audience &&
  a.eventId === b.eventId;

/** Видимая длина: как считает Telegram, без тегов. */
const visibleLength = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '_').length;

function StatsLine({ s }: { s: BroadcastStats }) {
  return (
    <dl className="ad-opening__stats">
      <div><dt>Получателей</dt><dd>{s.total}</dd></div>
      <div><dt>Доставлено</dt><dd>{s.sent}</dd></div>
      <div><dt>Заблокировали бота</dt><dd>{s.blocked}</dd></div>
      {s.unreachable > 0 && <div><dt>Не начинали диалог</dt><dd>{s.unreachable}</dd></div>}
      {s.skipped > 0 && <div><dt>Отписались</dt><dd>{s.skipped}</dd></div>}
      {s.failed > 0 && <div><dt>Ошибка</dt><dd>{s.failed}</dd></div>}
      {s.pending > 0 && <div><dt>В очереди</dt><dd>{s.pending}</dd></div>}
    </dl>
  );
}

/** Панель оформления: оборачивает выделенный текст в тег Telegram. */
function Toolbar({ area, onChange }: { area: React.RefObject<HTMLTextAreaElement | null>; onChange: (v: string) => void }) {
  const wrap = (open: string, close: string) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const next = value.slice(0, a) + open + value.slice(a, b) + close + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + open.length, b + open.length);
    });
  };
  const link = () => {
    const url = window.prompt('Адрес ссылки (https://…)', 'https://');
    if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) return;
    wrap(`<a href="${url.trim().replace(/"/g, '%22')}">`, '</a>');
  };
  return (
    <div className="ad-bc__toolbar" role="toolbar" aria-label="Оформление текста">
      <button type="button" className="ad-btn" title="Жирный" onClick={() => wrap('<b>', '</b>')}><b>Ж</b></button>
      <button type="button" className="ad-btn" title="Курсив" onClick={() => wrap('<i>', '</i>')}><i>К</i></button>
      <button type="button" className="ad-btn" title="Подчёркнутый" onClick={() => wrap('<u>', '</u>')}><u>Ч</u></button>
      <button type="button" className="ad-btn" title="Зачёркнутый" onClick={() => wrap('<s>', '</s>')}><s>З</s></button>
      <button type="button" className="ad-btn" title="Ссылка" onClick={link}>Ссылка</button>
      <button type="button" className="ad-btn" title="Цитата" onClick={() => wrap('<blockquote>', '</blockquote>')}>Цитата</button>
    </div>
  );
}

function Editor({
  initial,
  events,
  onSaved,
  onClose,
}: {
  initial: Broadcast | null;
  events: EventOption[];
  onSaved: (b: Broadcast) => void;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<Broadcast | null>(initial);
  const [draft, setDraft] = useState<BroadcastDraft>(initial ? draftOf(initial) : EMPTY);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const dirty = !saved || !sameDraft(draft, draftOf(saved));
  const set = (patch: Partial<BroadcastDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNotice(null);
    setConfirming(false);
  };

  useEffect(() => {
    let alive = true;
    if (draft.audience === 'EVENT' && !draft.eventId) {
      // Пока старт не выбран — считать нечего.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAudienceCount(null);
      return;
    }
    getBroadcastAudience(draft.audience, draft.eventId)
      .then((r) => alive && setAudienceCount(r.count))
      .catch(() => alive && setAudienceCount(null));
    return () => {
      alive = false;
    };
  }, [draft.audience, draft.eventId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  /** Сохранить, если есть несохранённое; вернуть актуальную рассылку. */
  const save = async (): Promise<Broadcast> => {
    if (saved && !dirty) return saved;
    const next = saved ? await updateBroadcast(saved.id, draft) : await createBroadcast(draft);
    setSaved(next);
    setDraft(draftOf(next));
    onSaved(next);
    return next;
  };

  const onPhoto = (file: File | undefined) =>
    run(async () => {
      if (!file) return;
      if (file.size > ROUTE_IMAGE_MAX_BYTES) throw new Error('Файл больше 5 МБ');
      const b = await save();
      const next = await uploadBroadcastPhoto(b.id, file);
      setSaved(next);
      onSaved(next);
    });

  const removePhoto = () =>
    run(async () => {
      if (!saved) return;
      const next = await deleteBroadcastPhoto(saved.id);
      setSaved(next);
      onSaved(next);
    });

  const test = () =>
    run(async () => {
      const b = await save();
      const next = await testBroadcast(b.id);
      setSaved(next);
      onSaved(next);
      setNotice('Тест отправлен вам в Telegram. Проверьте, как выглядит сообщение.');
    });

  const send = () =>
    run(async () => {
      if (!saved) return;
      setConfirming(false);
      const next = await sendBroadcast(saved.id);
      onSaved(next);
      onClose();
    });

  const remove = () =>
    run(async () => {
      if (!saved || !window.confirm('Удалить черновик?')) return;
      await deleteBroadcast(saved.id);
      onClose();
    });

  const length = visibleLength(draft.text);
  const limit = saved?.photoUrl ? 1024 : 4096;
  const tested = Boolean(saved?.testedAt) && !dirty;
  const canSend = tested && !saved?.problem && (audienceCount ?? 0) > 0;

  return (
    <section className="ad-card ad-bc">
      <h3>{saved ? `Рассылка №${saved.id}` : 'Новая рассылка'}</h3>

      <div className="ad-opening__text">
        <span>Текст сообщения</span>
        <Toolbar area={area} onChange={(text) => set({ text })} />
        <textarea ref={area} rows={8} value={draft.text} disabled={busy} onChange={(e) => set({ text: e.target.value })} />
        <span className={`ad-hint${length > limit ? ' ad-hint--error' : ''}`}>
          {length} / {limit}
          {saved?.photoUrl ? ' (с картинкой текст идёт подписью — до 1024 символов)' : ''}. Выделите текст и нажмите кнопку
          оформления.
        </span>
      </div>

      <div className="ad-bc__row">
        <span className="ad-bc__label">Картинка</span>
        {saved?.photoUrl ? (
          <div className="ad-bc__photo">
            <img src={assetUrl(saved.photoUrl)} alt="Картинка рассылки" />
            <button type="button" className="ad-btn" disabled={busy} onClick={() => void removePhoto()}>
              Убрать
            </button>
          </div>
        ) : (
          <label className="ad-btn ad-bc__file">
            Добавить (JPG, PNG, WebP до 5 МБ)
            <input type="file" accept={ROUTE_IMAGE_ACCEPT} hidden disabled={busy} onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
        )}
      </div>

      <div className="ad-bc__row">
        <span className="ad-bc__label">Кнопка</span>
        <select
          value={draft.buttonKind ?? ''}
          disabled={busy}
          onChange={(e) => {
            const kind = (e.target.value || null) as BroadcastDraft['buttonKind'];
            set({ buttonKind: kind, buttonText: kind === 'app' && !draft.buttonText ? 'Открыть приложение' : draft.buttonText });
          }}
        >
          <option value="">Без кнопки</option>
          <option value="url">Ссылка</option>
          <option value="app">Открыть Mini App</option>
        </select>
        {draft.buttonKind && (
          <input
            placeholder="Надпись на кнопке"
            maxLength={64}
            value={draft.buttonText ?? ''}
            disabled={busy}
            onChange={(e) => set({ buttonText: e.target.value })}
          />
        )}
        {draft.buttonKind === 'url' && (
          <input
            placeholder="https://…"
            type="url"
            value={draft.buttonUrl ?? ''}
            disabled={busy}
            onChange={(e) => set({ buttonUrl: e.target.value })}
          />
        )}
      </div>
      <p className="ad-hint ad-hint--dim">Под сообщением всегда будет кнопка «Не присылать новости».</p>

      <div className="ad-bc__row">
        <span className="ad-bc__label">Кому</span>
        <select
          value={draft.audience}
          disabled={busy}
          onChange={(e) => set({ audience: e.target.value as BroadcastAudience, eventId: null })}
        >
          {(Object.keys(AUDIENCE_LABELS) as BroadcastAudience[]).map((a) => (
            <option key={a} value={a}>{AUDIENCE_LABELS[a]}</option>
          ))}
        </select>
        {draft.audience === 'EVENT' && (
          <select value={draft.eventId ?? ''} disabled={busy} onChange={(e) => set({ eventId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Выберите старт</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{eventDateFmt.format(new Date(ev.date))} {ev.title}</option>
            ))}
          </select>
        )}
        <span className="ad-hint">
          {audienceCount === null ? '' : `Получат: ${audienceCount}`}
        </span>
      </div>
      <p className="ad-hint ad-hint--dim">
        Записанные на старт — оплатившие. Без регистрации — без оплаченных записей на старты. Отписавшиеся и заблокировавшие бота
        не получат.
      </p>

      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}
      {saved?.problem && !dirty && <p className="ad-msg ad-msg--error">{saved.problem}</p>}

      {confirming ? (
        <div className="ad-actions">
          <button type="button" className="ad-btn ad-btn--primary" disabled={busy} onClick={() => void send()}>
            Да, отправить {audienceCount} получателям
          </button>
          <button type="button" className="ad-btn" onClick={() => setConfirming(false)}>Отмена</button>
        </div>
      ) : (
        <div className="ad-actions">
          <button type="button" className="ad-btn" disabled={busy || !dirty} onClick={() => void run(async () => void (await save()))}>
            Сохранить черновик
          </button>
          <button type="button" className="ad-btn" disabled={busy || !draft.text.trim()} onClick={() => void test()}>
            Отправить мне тест
          </button>
          <button
            type="button"
            className="ad-btn ad-btn--primary"
            disabled={busy || !canSend}
            title={tested ? undefined : 'Сначала отправьте тест себе'}
            onClick={() => setConfirming(true)}
          >
            Отправить всем{audienceCount ? ` (${audienceCount})` : ''}
          </button>
          {saved && (
            <button type="button" className="ad-btn" disabled={busy} onClick={() => void remove()}>Удалить</button>
          )}
          <button type="button" className="ad-btn" disabled={busy} onClick={onClose}>Закрыть</button>
        </div>
      )}
      {!tested && <p className="ad-hint ad-hint--dim">«Отправить всем» станет доступна после теста себе. После правок тест нужен заново.</p>}
    </section>
  );
}

export default function BroadcastsSection() {
  const [list, setList] = useState<Broadcast[] | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [editing, setEditing] = useState<Broadcast | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getBroadcasts();
      setList(data.broadcasts);
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить');
    }
  }, []);

  useEffect(() => {
    // Загрузка с сервера при открытии раздела.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Пока что-то отправляется — обновляем ход раз в 2 секунды.
  const sending = list?.some((b) => b.status === 'SENDING') ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [sending, load]);

  const stop = async (b: Broadcast) => {
    if (!window.confirm('Остановить рассылку? Тем, кому ещё не отправили, сообщение не уйдёт.')) return;
    try {
      await cancelBroadcast(b.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось остановить');
    }
  };

  if (!list) return <p className="ad-msg">{error ?? 'Загружаем…'}</p>;

  if (editing) {
    return (
      <Editor
        key={editing === 'new' ? 'new' : editing.id}
        initial={editing === 'new' ? null : editing}
        events={events}
        onSaved={() => void load()}
        onClose={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  return (
    <section className="ad-card">
      <h3>Рассылки</h3>
      <p className="ad-hint">
        Сообщение в Telegram от бота: текст, картинка и кнопка. Сначала тест себе, потом всем — очередью, не больше ~22 сообщений в
        секунду. Итог придёт вам в бот, когда рассылка закончится.
      </p>
      <div className="ad-actions">
        <button type="button" className="ad-btn ad-btn--primary" onClick={() => setEditing('new')}>
          Новая рассылка
        </button>
      </div>
      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {list.length === 0 ? (
        <p className="ad-hint">Рассылок пока не было.</p>
      ) : (
        <ul className="ad-bc__list">
          {list.map((b) => (
            <li key={b.id} className="ad-bc__item">
              <div className="ad-bc__head">
                <b>№{b.id}</b>
                <span className={`ad-bc__status ad-bc__status--${b.status.toLowerCase()}`}>{STATUS_LABELS[b.status]}</span>
                <span className="ad-hint">
                  {AUDIENCE_LABELS[b.audience]}
                  {b.audience === 'EVENT' && b.eventId ? `: ${events.find((e) => e.id === b.eventId)?.title ?? ''}` : ''}
                  {' · '}
                  {dateFmt.format(new Date(b.startedAt ?? b.createdAt))}
                </span>
              </div>
              <p className="ad-bc__preview">{b.text.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 160)}</p>
              {b.stats && <StatsLine s={b.stats} />}
              <div className="ad-actions">
                {b.status === 'DRAFT' && (
                  <button type="button" className="ad-btn" onClick={() => setEditing(b)}>Открыть</button>
                )}
                {b.status === 'SENDING' && (
                  <button type="button" className="ad-btn" onClick={() => void stop(b)}>Остановить</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
