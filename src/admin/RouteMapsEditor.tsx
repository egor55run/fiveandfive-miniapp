import { useRef, useState } from 'react';
import {
  addRouteMap,
  assetUrl,
  deleteRouteMap,
  ROUTE_IMAGE_ACCEPT,
  ROUTE_IMAGE_MAX_BYTES,
  updateRouteMaps,
  type AdminRouteMap,
} from './api';

/**
 * Карты трасс старта: несколько картинок с подписями («5 км», «3 км») и
 * порядком — в приложении и на сайте листаются свайпом. Каждое действие сразу
 * уходит на сервер (а не по «Сохранить» формы): файл загружается отдельным
 * multipart-запросом, и держать его до сохранения незачем.
 */
export default function RouteMapsEditor({
  eventId,
  initial,
  onChange,
}: {
  eventId: number;
  initial: AdminRouteMap[];
  onChange: (maps: AdminRouteMap[]) => void;
}) {
  const [maps, setMaps] = useState<AdminRouteMap[]>(initial);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Что сейчас на сервере — чтобы не сохранять подпись, если она не менялась.
  const saved = useRef(initial);

  const apply = (next: AdminRouteMap[]) => {
    saved.current = next;
    setMaps(next);
    onChange(next);
  };

  const run = async (action: () => Promise<AdminRouteMap[]>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить карты');
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | null) => {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = '';
    // Окончательная проверка — на сервере (по содержимому); здесь отсекаем
    // заведомо чужое, чтобы не гонять файл по сети зря.
    if (file.type && !ROUTE_IMAGE_ACCEPT.split(',').includes(file.type)) {
      setError('Карта должна быть JPG, PNG или WebP');
      return;
    }
    if (file.size > ROUTE_IMAGE_MAX_BYTES) {
      setError(`Файл больше ${Math.round(ROUTE_IMAGE_MAX_BYTES / 1024 / 1024)} МБ`);
      return;
    }
    void run(async () => {
      const res = await addRouteMap(eventId, file, caption.trim());
      setCaption('');
      return res.routeMaps;
    });
  };

  const save = (next: AdminRouteMap[]) =>
    run(async () => (await updateRouteMaps(eventId, next.map((m) => ({ id: m.id, caption: m.caption })))).routeMaps);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= maps.length) return;
    const next = [...maps];
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
  };

  const remove = (m: AdminRouteMap) => {
    if (!window.confirm(`Убрать карту${m.caption ? ` «${m.caption}»` : ''}?`)) return;
    void run(async () => (await deleteRouteMap(eventId, m.id)).routeMaps);
  };

  return (
    <div className="ad-route">
      <span className="ad-route__label">Карты трасс</span>
      <div className="ad-route__body">
        {maps.length === 0 ? (
          <div className="ad-route__preview ad-route__preview--empty">
            Карт нет — в приложении будет плейсхолдер, на сайте «Трасса будет опубликована позже»
          </div>
        ) : (
          <ol className="ad-maps">
            {maps.map((m, i) => (
              <li key={m.id} className="ad-maps__item">
                <img className="ad-maps__thumb" src={assetUrl(m.url)} alt={m.caption || `Карта ${i + 1}`} />
                <input
                  className="ad-maps__caption"
                  value={m.caption}
                  placeholder="Подпись, например «5 км»"
                  maxLength={50}
                  disabled={busy}
                  aria-label="Подпись к карте"
                  onChange={(e) =>
                    setMaps((prev) => prev.map((x) => (x.id === m.id ? { ...x, caption: e.target.value } : x)))
                  }
                  onBlur={() => {
                    const before = saved.current.find((x) => x.id === m.id)?.caption;
                    if (before !== m.caption) void save(maps);
                  }}
                />
                <div className="ad-maps__actions">
                  <button type="button" className="ad-btn ad-btn--sm" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Выше">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ad-btn ad-btn--sm"
                    disabled={busy || i === maps.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Ниже"
                  >
                    ↓
                  </button>
                  <button type="button" className="ad-btn ad-btn--sm ad-btn--danger" disabled={busy} onClick={() => remove(m)}>
                    Убрать
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="ad-route__controls">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Подпись новой карты (5 км)"
            maxLength={50}
            disabled={busy || maps.length >= 10}
            aria-label="Подпись новой карты"
          />
          <input
            ref={fileRef}
            type="file"
            accept={ROUTE_IMAGE_ACCEPT}
            disabled={busy || maps.length >= 10}
            onChange={(e) => upload(e.target.files?.[0] ?? null)}
            aria-label="Файл карты"
          />
        </div>
        {error && <p className="ad-msg ad-msg--error">{error}</p>}
        <p className="ad-hint">
          Сначала подпись, потом файл — карта сразу добавится в конец. JPG, PNG или WebP, до{' '}
          {Math.round(ROUTE_IMAGE_MAX_BYTES / 1024 / 1024)} МБ, до 10 карт. Порядок — как листаются в
          приложении и на сайте; первая — главная (её видно в превью ссылки).
        </p>
      </div>
    </div>
  );
}
