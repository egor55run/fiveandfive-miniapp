import { useState } from 'react';
import { assetUrl, deleteTheme, ROUTE_IMAGE_ACCEPT, ROUTE_IMAGE_MAX_BYTES, updateEvent, uploadTheme, type AdminEvent } from './api';

/**
 * Оформление старта в Mini App: фон, логотип и акцентный цвет. Файлы
 * загружаются сразу (как карты трасс), цвет — кнопкой «Сохранить цвет».
 * Без оформления старт выглядит как обычно.
 */
export default function ThemeEditor({ event, onChange }: { event: AdminEvent; onChange: (e: AdminEvent) => void }) {
  const [accent, setAccent] = useState(event.theme?.accent ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (label: string, job: () => Promise<AdminEvent>, done: string) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      onChange(await job());
      setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(null);
    }
  };

  const pick = (kind: 'bg' | 'logo', file: File | undefined) => {
    if (!file) return;
    if (file.size > ROUTE_IMAGE_MAX_BYTES) {
      setError('Файл больше 5 МБ');
      return;
    }
    void run(kind, () => uploadTheme(event.id, kind, file), kind === 'bg' ? 'Фон загружен' : 'Логотип загружен');
  };

  const validAccent = accent === '' || /^#[0-9a-fA-F]{6}$/.test(accent);
  const files: { kind: 'bg' | 'logo'; label: string; url: string | null | undefined; hint: string }[] = [
    { kind: 'bg', label: 'Фон', url: event.theme?.bgUrl, hint: 'Широкая картинка, примерно 1200×600: верх карточки и страницы старта' },
    { kind: 'logo', label: 'Логотип', url: event.theme?.logoUrl, hint: 'PNG с прозрачным фоном, примерно 400×400' },
  ];

  return (
    <div className="ad-route">
      <span className="ad-route__label">Оформление в приложении</span>
      <div className="ad-route__body">
        {files.map((f) => (
          <div className="ad-theme__row" key={f.kind}>
            <span className="ad-theme__name">{f.label}</span>
            {f.url ? (
              <img className={`ad-theme__preview ad-theme__preview--${f.kind}`} src={assetUrl(f.url)} alt={f.label} />
            ) : (
              <span className="ad-hint ad-hint--dim">не загружен</span>
            )}
            <input type="file" accept={ROUTE_IMAGE_ACCEPT} disabled={busy !== null} onChange={(e) => pick(f.kind, e.target.files?.[0])} />
            {f.url && (
              <button
                type="button"
                className="ad-btn ad-btn--sm"
                disabled={busy !== null}
                onClick={() => void run(f.kind, () => deleteTheme(event.id, f.kind), `${f.label} убран`)}
              >
                Убрать
              </button>
            )}
            <span className="ad-hint ad-hint--dim">{f.hint}</span>
          </div>
        ))}
        <div className="ad-theme__row">
          <span className="ad-theme__name">Акцентный цвет</span>
          <input
            type="color"
            value={validAccent && accent ? accent : '#ff6a13'}
            onChange={(e) => setAccent(e.target.value)}
            aria-label="Акцентный цвет"
          />
          <input value={accent} onChange={(e) => setAccent(e.target.value.trim())} placeholder="#FF6A13" maxLength={7} className="ad-input--num" />
          <button
            type="button"
            className="ad-btn ad-btn--sm"
            disabled={busy !== null || !validAccent || (accent || null) === (event.theme?.accent ?? null)}
            onClick={() => void run('accent', () => updateEvent(event.id, { themeAccent: accent || null }), accent ? 'Цвет сохранён' : 'Цвет убран')}
          >
            Сохранить цвет
          </button>
          {accent && (
            <button type="button" className="ad-btn ad-btn--sm" disabled={busy !== null} onClick={() => setAccent('')}>
              Без цвета
            </button>
          )}
          <span className="ad-hint ad-hint--dim">Кнопки и акценты старта; цвет текста на них подберётся сам, чтобы читалось.</span>
        </div>
        {busy && <p className="ad-msg">Сохраняем…</p>}
        {error && <p className="ad-msg ad-msg--error">{error}</p>}
        {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}
      </div>
    </div>
  );
}
