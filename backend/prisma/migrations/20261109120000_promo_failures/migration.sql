-- CreateTable
CREATE TABLE "promo_failures" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_failures_telegram_id_created_at_idx" ON "promo_failures"("telegram_id", "created_at");

-- CreateIndex
CREATE INDEX "promo_failures_ip_hash_created_at_idx" ON "promo_failures"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "promo_failures_created_at_idx" ON "promo_failures"("created_at");

