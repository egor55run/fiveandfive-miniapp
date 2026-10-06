import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma';
import { getInvoice, invoiceIdFromWebhook, verifyWebhookSignature } from '../lib/apipay';
import { apiPayConfigured, applyInvoice, refreshPayment, serializePayment } from '../lib/payments';
import { requireTelegramAuth, tgUserOf } from '../plugins/telegramAuth';

/** Не чаще раза в столько мс спрашиваем ApiPay из-за опроса приложения. */
const POLL_REFRESH_MS = 4_000;

export async function paymentsRoutes(app: FastifyInstance) {
  /**
   * GET /payments/:id — статус оплаты для экрана «Оплатите счёт в Kaspi».
   * Приложение опрашивает его раз в несколько секунд. Если вебхук ещё не
   * пришёл, сами спрашиваем ApiPay — так оплата подтверждается даже без
   * вебхука (например, при локальной разработке).
   */
  app.get<{ Params: { id: string } }>(
    '/payments/:id',
    { preHandler: requireTelegramAuth },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: 'Некорректный id' });
      }
      const tg = tgUserOf(req);

      let payment = await prisma.payment.findUnique({
        where: { id },
        include: { user: { select: { telegramId: true } } },
      });
      // Чужой платёж отвечаем как несуществующий — не раскрываем, что id занят.
      if (!payment || payment.user.telegramId !== BigInt(tg.id)) {
        return reply.code(404).send({ error: 'Платёж не найден' });
      }

      const stale =
        !payment.checkedAt || Date.now() - payment.checkedAt.getTime() > POLL_REFRESH_MS;
      if (
        apiPayConfigured() &&
        stale &&
        (payment.state === 'PENDING' || payment.state === 'CREATED')
      ) {
        const fresh = await refreshPayment(payment, req.log);
        payment = { ...payment, ...fresh };
      }

      return { payment: serializePayment(payment) };
    },
  );

  /**
   * POST /payments/apipay/webhook — уведомление ApiPay о смене статуса счёта.
   * Снаружи: https://fiveandfive.kz/api/payments/apipay/webhook (nginx /api/).
   *
   * Отдельный плагин — потому что подпись считается по СЫРОМУ телу, и JSON
   * здесь парсим сами. Парсер переопределён только внутри этого плагина,
   * остальные роуты получают обычный разобранный JSON.
   */
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_req, body, done) => {
      done(null, body);
    });

    scope.post('/payments/apipay/webhook', async (req, reply) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const signature = req.headers['x-webhook-signature'];

      if (!verifyWebhookSignature(raw, Array.isArray(signature) ? signature[0] : signature)) {
        req.log.warn({ ip: req.ip }, 'Вебхук ApiPay с неверной подписью отклонён');
        return reply.code(401).send({ error: 'invalid signature' });
      }

      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send({ error: 'invalid json' });
      }

      const invoiceId = invoiceIdFromWebhook(body);
      const event = (body as { event?: unknown }).event;
      req.log.info({ invoiceId, event }, 'Вебхук ApiPay');
      if (!invoiceId) return reply.code(200).send({ ok: true, ignored: true });

      // ApiPay ждёт ответ до 5 секунд — отвечаем сразу, обрабатываем после.
      // Статус берём не из тела, а свежим GET: тело только повод проверить.
      const log = req.log;
      setImmediate(() => {
        getInvoice(invoiceId)
          .then((invoice) => applyInvoice(invoice, log))
          .catch((err) => log.error({ invoiceId, err: String(err) }, 'Вебхук ApiPay: сбой обработки'));
      });

      return reply.code(200).send({ ok: true });
    });
  });
}
