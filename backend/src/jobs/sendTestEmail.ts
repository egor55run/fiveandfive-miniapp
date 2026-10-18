/**
 * Тестовые письма — все три вида на указанный адрес, по ближайшему старту:
 *   cd backend && set -a && . ./.env && set +a && node dist/jobs/sendTestEmail.js you@example.com
 * В журнал писем не пишется и участников не трогает.
 */
import { prisma } from '../prisma';
import { emailEnabled, sendEmail } from '../lib/email';
import { dayBeforeEmail, registrationEmail, seasonPassEmail } from '../lib/emailTemplates';

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) throw new Error('Укажите адрес: node dist/jobs/sendTestEmail.js you@example.com');
  if (!emailEnabled()) throw new Error('Почта выключена: нужны EMAIL_ENABLED=true, POSTBOX_SMTP_USER и POSTBOX_SMTP_PASSWORD в .env');
  const events = await prisma.event.findMany({ where: { date: { gt: new Date() } }, orderBy: { date: 'asc' } });
  if (events.length === 0) throw new Error('Нет будущих стартов для примера');
  const [first] = events;
  const letters = [
    registrationEmail({ firstName: 'Тест', event: first, distance: '5 км', paidAmount: Number(first.price) }),
    seasonPassEmail({ firstName: 'Тест', events, distance: '5 км' }),
    dayBeforeEmail({ firstName: 'Тест', event: first, distance: '5 км' }),
  ];
  for (const msg of letters) {
    const res = await sendEmail(to, { ...msg, subject: `[ТЕСТ] ${msg.subject}` });
    console.log(res.ok ? 'отправлено:' : 'ошибка:', msg.subject, res.ok ? '' : res.error);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
