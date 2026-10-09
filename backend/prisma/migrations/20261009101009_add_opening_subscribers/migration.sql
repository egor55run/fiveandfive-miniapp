-- CreateTable
CREATE TABLE "opening_subscribers" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "first_name" TEXT,
    "username" TEXT,
    "source" TEXT,
    "subscribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribed_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "notify_status" TEXT,
    "notify_error" TEXT,

    CONSTRAINT "opening_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_subscribers_telegram_id_key" ON "opening_subscribers"("telegram_id");

