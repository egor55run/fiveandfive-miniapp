-- Возвраты через API ApiPay (2026-11-12).
CREATE TYPE "RefundRequestStatus" AS ENUM ('SENDING', 'PENDING', 'COMPLETED', 'FAILED', 'UNCERTAIN', 'DISMISSED');

CREATE TABLE "refund_requests" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "whole_pass" BOOLEAN NOT NULL DEFAULT false,
    "stages" JSONB NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'SENDING',
    "idempotency_key" TEXT NOT NULL,
    "provider_refund_id" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "admin_telegram_id" BIGINT,
    "completed_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refund_requests_idempotency_key_key" ON "refund_requests"("idempotency_key");
CREATE UNIQUE INDEX "refund_requests_provider_refund_id_key" ON "refund_requests"("provider_refund_id");
CREATE INDEX "refund_requests_payment_id_status_idx" ON "refund_requests"("payment_id", "status");
CREATE INDEX "refund_requests_status_updated_at_idx" ON "refund_requests"("status", "updated_at");

ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refunds" ADD COLUMN "request_id" INTEGER;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "refund_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Неудачные возвраты из ApiPay раньше записывались строкой на 0 ₸ без этапа
-- (метка «уже сообщили»). Переносим их в refund_requests как FAILED, строки убираем:
-- в «Финансах» и выгрузке им не место.
INSERT INTO "refund_requests" ("payment_id", "user_id", "amount", "stages", "status", "idempotency_key", "provider_refund_id", "error_code", "created_at", "updated_at")
SELECT r."payment_id", r."user_id", 0, '[]'::jsonb, 'FAILED', 'legacy-failed-' || r."id", r."provider_refund_id", 'legacy', r."created_at", r."created_at"
FROM "refunds" r
WHERE r."source" = 'APIPAY' AND r."amount" = 0 AND r."percent" IS NULL AND r."registration_id" IS NULL AND r."payment_id" IS NOT NULL AND r."provider_refund_id" IS NOT NULL;
DELETE FROM "refunds" r
WHERE r."source" = 'APIPAY' AND r."amount" = 0 AND r."percent" IS NULL AND r."registration_id" IS NULL AND r."payment_id" IS NOT NULL AND r."provider_refund_id" IS NOT NULL;
