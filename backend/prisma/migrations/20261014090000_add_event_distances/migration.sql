-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "distance_id" INTEGER;

-- CreateTable
CREATE TABLE "event_distances" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "slots_total" INTEGER NOT NULL,
    "slots_taken" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "season_pass" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_distances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_distances_event_id_idx" ON "event_distances"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_distances_event_id_label_key" ON "event_distances"("event_id", "label");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_distance_id_fkey" FOREIGN KEY ("distance_id") REFERENCES "event_distances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_distances" ADD CONSTRAINT "event_distances_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Данные: у каждого старта была одна дистанция — переносим её как есть
-- (название, лимит, занято, цена), абонемент записывает на неё же.
INSERT INTO "event_distances" ("event_id", "label", "slots_total", "slots_taken", "price", "sort_order", "season_pass")
SELECT "id", "distance", "slots_total", "slots_taken", "price", 0, true FROM "events";

-- Все существующие регистрации — на эту единственную дистанцию своего старта.
UPDATE "registrations" r
SET "distance_id" = d."id"
FROM "event_distances" d
WHERE d."event_id" = r."event_id";
