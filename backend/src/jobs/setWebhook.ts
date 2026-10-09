import { setWebhook } from '../lib/telegramBot';

/**
 * Сообщить Telegram, куда присылать входящие сообщения боту:
 *   cd backend && set -a && . ./.env && set +a && node dist/jobs/setWebhook.js
 * Адрес — ${APP_URL}/api/telegram/webhook (nginx проксирует /api/ на бэкенд),
 * секрет — TELEGRAM_WEBHOOK_SECRET. Повторный запуск безопасен.
 */
async function main() {
  const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!appUrl || !secret) {
    console.error('Нужны APP_URL и TELEGRAM_WEBHOOK_SECRET в окружении');
    process.exit(1);
  }
  const url = `${appUrl}/api/telegram/webhook`;
  const result = await setWebhook(url, secret);
  console.log(`Вебхук установлен: ${url} (${result})`);
}

main().catch((err) => {
  console.error('Не удалось установить вебхук:', err instanceof Error ? err.message : err);
  process.exit(1);
});
