-- CreateTable
CREATE TABLE "broadcasts" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "photo_url" TEXT,
    "photo_file_id" TEXT,
    "button_kind" TEXT,
    "button_text" TEXT,
    "button_url" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "event_id" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "tested_at" TIMESTAMP(3),
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_deliveries" (
    "id" SERIAL NOT NULL,
    "broadcast_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "broadcast_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "broadcast_deliveries_broadcast_id_status_idx" ON "broadcast_deliveries"("broadcast_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_deliveries_broadcast_id_telegram_id_key" ON "broadcast_deliveries"("broadcast_id", "telegram_id");

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

