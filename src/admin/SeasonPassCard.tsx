import { useState } from 'react';
import { updateSeason, type SeasonOption } from './api';
import { formatDateTime, priceFmt, toDateTimeLocal } from './helpers';

/**
 * Абонемент сезона: цена и дата закрытия продажи. Пустая дата — продажа
 * закрывается вместе с регистрацией на первый старт сезона. Правила продажи
 * (только до регистрации на отдельные старты) проверяет сервер.
 */
export default function SeasonPassCard({ season, onSaved }: { season: SeasonOption; onSaved: (s: SeasonOption) => void }) {
  const [price, setPrice] = useState(String(season.price));
  const [closesAt, setClosesAt] = useState(season.salesClosesAtCustom ? toDateTimeLocal(season.salesClosesAtCustom) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    const value = Number(price);
    if (!Number.isFinite(value) || value < 0) {
      setError('Некорректная цена');
      return;
    }
    if (closesAt && season.firstEventDate && new Date(closesAt) > new Date(season.firstEventDate)) {
      setError('Продажа абонемента должна закрываться не позже первого старта сезона');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateSeason(season.id, {
        price: value,
        // datetime-local — местное время браузера; на сервер — в UTC.
        salesClosesAt: closesAt ? new Date(closesAt).toISOString() : null,
      });
      onSaved(saved);
      setNotice('Сохранено. Уже выставленные счета не меняются.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ad-card">
      <h3>
        Абонемент: {season.title}
        {season.isActive ? '' : ' (сезон не активен)'}
      </h3>
      <div className="ad-form">
        <label>
          <span>Цена абонемента, ₸</span>
          <input type="number" min="0" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} />
          <span className="ad-hint ad-hint--dim">Сейчас: {priceFmt.format(season.price)} ₸</span>
        </label>
        <label>
          <span>Продажа абонемента закрывается</span>
          <input type="datetime-local" value={closesAt} disabled={busy} onChange={(e) => setClosesAt(e.target.value)} />
          <span className="ad-hint ad-hint--dim">
            {closesAt
              ? 'Задано вручную. Очистите поле — вернётся «вместе с регистрацией на 1-й этап»'
              : `Пусто — вместе с регистрацией на 1-й этап${season.salesClosesAt ? `: ${formatDateTime(season.salesClosesAt)}` : ''}`}
          </span>
        </label>
      </div>
      <p className="ad-hint">
        {season.salesOpen ? 'Продажа открыта' : 'Продажа закрыта'}. Купить абонемент можно, только пока у человека нет
        оплаченной или ожидающей оплаты записи на отдельный старт сезона — проверяет сервер.
      </p>
      {error && <p className="ad-msg ad-msg--error">{error}</p>}
      {notice && <p className="ad-msg ad-msg--ok">{notice}</p>}
      <div className="ad-actions">
        <button type="button" className="ad-btn ad-btn--primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
