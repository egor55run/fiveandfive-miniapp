import { useEffect, useState } from 'react';
import { getDuplicates, mergeUsers, type DuplicateCandidate, type Participant } from './api';
import { fullName } from './helpers';

/**
 * Двойники участника: тот же телефон, email или те же фамилия и имя.
 * «Объединить» переносит регистрации, результаты, платежи и согласия на
 * одного человека (с Telegram — он остаётся), второй удаляется. Если оба
 * записаны на один старт — сервер откажет: сначала отмените одну запись.
 */
export default function DuplicatesPanel({ participant, onDone, onClose }: { participant: Participant; onDone: (msg: string) => void; onClose: () => void }) {
  const [list, setList] = useState<DuplicateCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getDuplicates(participant.userId)
      .then((l) => alive && setList(l))
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Не удалось найти двойников'));
    return () => {
      alive = false;
    };
  }, [participant.userId]);

  const merge = async (c: DuplicateCandidate) => {
    // Остаётся тот, у кого Telegram: он входит в приложение.
    const meHasTelegram = participant.telegramId !== null;
    const into = meHasTelegram || !c.telegram ? participant.userId : c.userId;
    const from = into === participant.userId ? c.userId : participant.userId;
    const keep = into === participant.userId ? fullName(participant.lastName, participant.firstName) : c.name;
    const drop = into === participant.userId ? c.name : fullName(participant.lastName, participant.firstName);
    if (!window.confirm(`Объединить: всё от «${drop}» перейдёт к «${keep}», «${drop}» будет удалён. Продолжить?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mergeUsers(into, from);
      const moved = Object.entries(res.moved)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}: ${n}`)
        .join(', ');
      onDone(`Объединено: «${drop}» → «${keep}»${moved ? ` (${moved})` : ''}. Записано в журнал.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось объединить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-card">
      <h3>Двойники: {fullName(participant.lastName, participant.firstName)}</h3>
      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {!list ? (
        <p className="ad-msg">Ищем…</p>
      ) : list.length === 0 ? (
        <p className="ad-hint">Похожих участников нет (тот же телефон, email или фамилия и имя).</p>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Дата рождения</th>
                <th>Telegram</th>
                <th>Старты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.userId}>
                  <td>{c.name}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>{c.email ?? '—'}</td>
                  <td>{c.birthDate ? c.birthDate.split('-').reverse().join('.') : '—'}</td>
                  <td>{c.telegram ? (c.username ? `@${c.username}` : 'есть') : 'нет'}</td>
                  <td>{c.events.join(', ') || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="ad-btn ad-btn--sm"
                      disabled={busy || (c.telegram && participant.telegramId !== null)}
                      title={c.telegram && participant.telegramId !== null ? 'У обоих свой Telegram — объединять нельзя' : undefined}
                      onClick={() => void merge(c)}
                    >
                      Объединить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ad-actions">
        <button type="button" className="ad-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
