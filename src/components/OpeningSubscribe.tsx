import { useEffect, useState } from 'react';
import { getOpeningSubscription, subscribeOpening } from '../lib/api';
import { askWriteAccess } from '../lib/telegram';

type State = 'loading' | 'idle' | 'busy' | 'subscribed' | 'denied' | 'error';

/**
 * «Сообщить мне об открытии» — на экране «Регистрация скоро откроется».
 *
 * Тот же список подписчиков, что у бота. Сначала просим у Telegram разрешение
 * боту писать человеку: открыв Mini App по ссылке, он мог ни разу не начинать
 * диалог с ботом, и тогда сообщение об открытии до него бы не дошло.
 */
export default function OpeningSubscribe() {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    let alive = true;
    getOpeningSubscription()
      .then((subscribed) => alive && setState(subscribed ? 'subscribed' : 'idle'))
      .catch(() => alive && setState('idle'));
    return () => {
      alive = false;
    };
  }, []);

  const subscribe = async () => {
    setState('busy');
    if (!(await askWriteAccess())) {
      setState('denied');
      return;
    }
    try {
      await subscribeOpening();
      setState('subscribed');
    } catch {
      setState('error');
    }
  };

  if (state === 'loading') return null;
  if (state === 'subscribed') {
    return <p className="reg-closed__done">Готово — напишем в Telegram, как только откроем регистрацию.</p>;
  }
  return (
    <>
      <button
        type="button"
        className="btn-register"
        disabled={state === 'busy'}
        onClick={() => void subscribe()}
      >
        {state === 'busy' ? 'Подписываем…' : 'Сообщить мне об открытии'}
      </button>
      {state === 'denied' && (
        <p className="reg-closed__text">
          Без разрешения писать вам бот не сможет сообщить об открытии. Нажмите ещё раз и
          разрешите.
        </p>
      )}
      {state === 'error' && (
        <p className="reg-closed__text">Не получилось подписаться — попробуйте ещё раз.</p>
      )}
    </>
  );
}
