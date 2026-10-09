'use client';

import { useEffect } from 'react';

/**
 * Ставит на паузу бесконечные анимации блоков, которых не видно на экране
 * (элементы с data-anim), — телефон не тратит на них силы впустую.
 */
export default function AnimPause() {
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>('[data-anim]');
    if (!('IntersectionObserver' in window) || nodes.length === 0) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.removeAttribute('data-paused');
        else e.target.setAttribute('data-paused', '');
      }
    });
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return null;
}
