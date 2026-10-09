'use client';

import { useEffect, useState } from 'react';
import type { EventDto } from '../../lib/api';
import { anyRegistrationOpen, botChatLink } from '../../site/links';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Кнопка в шапке: подписка на открытие в боте, а когда запись уже идёт —
 * в бота регистрироваться. Шапка общая со страницами документов, которые
 * собираются заранее, поэтому состояние узнаём уже в браузере.
 */
export default function HeaderCta({ notify, register }: { notify: string; register: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_URL}/events`, { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<EventDto[]>) : null))
      .then((events) => setOpen(anyRegistrationOpen(events)))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <a className="site-btn site-btn--dark site-header__cta" href={botChatLink(open ? undefined : 'notify')}>
      {open ? register : notify}
    </a>
  );
}
