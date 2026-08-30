/**
 * Точка входа рассылки напоминаний. Отдельный файл, потому что импорт логики не
 * должен ничего запускать.
 *
 * Планировщик — pm2 cron на сервере, «0 4 * * *» = 09:00 по Астане:
 *
 *   pm2 start dist/jobs/runRaceReminders.js --name fiveandfive-reminders \
 *     --no-autorestart --cron "0 4 * * *" && pm2 save
 *
 * Руками:
 *   npm run job:reminders                        — прогон
 *   NOTIFY_ENABLED=false npm run job:reminders   — сухой прогон без отправки
 *   pm2 restart fiveandfive-reminders            — прогон на сервере
 */
import { prisma } from '../prisma';
import { jobLog, sendRaceReminders } from './raceReminders';

async function main() {
  const started = Date.now();
  try {
    const stats = await sendRaceReminders();
    jobLog.info({ ...stats, ms: Date.now() - started }, 'Напоминания: готово');
  } finally {
    // Процесс одноразовый: держать пул открытым незачем, иначе pm2 будет
    // считать приложение живым и cron не сработает повторно.
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Напоминания: сбой', err);
  process.exit(1);
});
