import { useCallback, useEffect, useState } from 'react';
import { getSeasons, getSeasonSummaryStatus, publishSeasonSummary, type SeasonOption, type SeasonSummaryStatus } from './api';
import { formatDateTime } from './helpers';

/**
 * «Подвести итоги сезона» (2026-11-12): фиксирует итоговый рейтинг, включает
 * личные итоги в Mini App, рассылку «Ваши итоги сезона готовы» и страницу
 * /itogi/<год>. Доступно, когда опубликованы все этапы и кончилось окно
 * протестов последнего. Повторное нажатие пересчитывает итоги (сообщения
 * повторно не уходят).
 */
export default function SeasonSummaryCard() {
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [st, setSt] = useState<SeasonSummaryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getSeasons()
      .then((s) => {
        setSeasons(s);
        setSeasonId((s.find((x) => x.isActive) ?? s[0])?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (id: number) => {
    try {
      setSt(await getSeasonSummaryStatus(id));
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Не удалось загрузить итоги' });
    }
  }, []);

  useEffect(() => {
    // Загрузка при выборе сезона — синхронизация с API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (seasonId !== null) void load(seasonId);
  }, [seasonId, load]);

  const publish = async () => {
    if (!st) return;
    const again = st.publishedAt !== null;
    const ok = window.confirm(
      again
        ? 'Пересчитать итоги сезона? Итоговый рейтинг и страница /itogi обновятся; повторных сообщений участникам не будет.'
        : `Подвести итоги сезона ${st.year}? Рейтинг будет зафиксирован, у участников появятся личные итоги, бот разошлёт «Ваши итоги сезона готовы».`,
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await publishSeasonSummary(st.seasonId);
      setMsg({
        ok: true,
        text: r.republished
          ? 'Итоги пересчитаны.'
          : `Итоги подведены. Сообщения в боте уходят в фоне: участников с финишами — ${r.recipients}.`,
      });
      await load(st.seasonId);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Не удалось подвести итоги' });
    } finally {
      setBusy(false);
    }
  };

  if (seasons.length === 0) return null;
  const r = st?.readiness;
  return (
    <div className="ad-card">
      <h3>Итоги сезона</h3>
      <div className="ad-actions">
        {seasons.length > 1 && (
          <select value={seasonId ?? ''} onChange={(e) => setSeasonId(Number(e.target.value))} aria-label="Сезон">
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        {st && (
          <button type="button" className="ad-btn ad-btn--primary" disabled={busy || !r?.ready} onClick={() => void publish()}>
            {busy ? 'Считаем…' : st.publishedAt ? 'Пересчитать итоги' : 'Подвести итоги сезона'}
          </button>
        )}
        {st && (
          <a className="ad-btn" href={`/itogi/${st.year}`} target="_blank" rel="noreferrer">
            Страница /itogi/{st.year}
          </a>
        )}
      </div>
      {st && (
        <p className="ad-hint">
          Этапов с опубликованными результатами: {r?.stagesPublished} из {r?.stagesTotal}.
          {r?.protestUntil && ` Протесты по последнему этапу — до ${formatDateTime(r.protestUntil)}.`}
          {!r?.ready && r?.reason && ` Пока нельзя: ${r.reason}.`}
        </p>
      )}
      {st?.publishedAt && (
        <p className="ad-hint">
          Итоги подведены {formatDateTime(st.publishedAt)}.
          {st.messages && ` Сообщения «Ваши итоги сезона готовы»: отправлено ${st.messages.sent} из ${st.messages.recipients}` +
            (st.messages.failed ? `, не дошло ${st.messages.failed} (бот не может написать)` : '') + '.'}
        </p>
      )}
      {msg && <p className={`ad-msg ${msg.ok ? 'ad-msg--ok' : 'ad-msg--error'}`}>{msg.text}</p>}
    </div>
  );
}
