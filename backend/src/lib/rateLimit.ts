import type { FastifyRequest } from 'fastify';
import { verifyInitData } from './telegramAuth';

/**
 * Лимиты частоты на дорогих роутах (2026-11-09). Считаем на Telegram-аккаунт,
 * а не на адрес: у мобильных операторов за одним IP сидят тысячи людей, и лимит
 * на адрес в день открытия регистрации отсёк бы настоящих участников. Без
 * верной подписи — на адрес. По адресу защищают ещё nginx (limit_req) и общий
 * лимит в server.ts.
 */
function keyOf(req: FastifyRequest): string {
  const header = req.headers.authorization;
  const token = process.env.BOT_TOKEN;
  if (header?.startsWith('tma ') && token) {
    const res = verifyInitData(header.slice(4), token);
    if (res.ok) return `tg:${res.user.id}`;
  }
  return `ip:${req.ip}`;
}

/** Запись на старт и абонемент: человеку хватает с запасом, боту — нет. */
export const WRITE_LIMIT = { max: 10, timeWindow: '1 minute', keyGenerator: keyOf };

/** Проверка промокода при вводе. Неверные попытки считает ещё lib/promoGuard. */
export const PROMO_CHECK_LIMIT = { max: 20, timeWindow: '1 minute', keyGenerator: keyOf };
