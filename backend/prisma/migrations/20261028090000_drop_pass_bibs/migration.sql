-- Отдельный диапазон номеров абонементов убран (решение пользователя 2026-10-28):
-- абонемент получает номер на каждом старте из диапазона дистанции, как все.
-- Номера регистраций абонемента вне диапазона своей дистанции (старые 1–1000)
-- сбрасываем — их выдаст заново «Выдать номера» в админке или следующая оплата.
UPDATE "registrations" r SET "bib_number" = NULL
FROM "event_distances" d
WHERE d."id" = r."distance_id" AND r."season_pass_id" IS NOT NULL AND r."bib_number" IS NOT NULL
  AND (d."bib_from" IS NULL OR r."bib_number" NOT BETWEEN d."bib_from" AND d."bib_to");

-- DropIndex
DROP INDEX "season_passes_season_id_bib_number_key";

-- AlterTable
ALTER TABLE "seasons" DROP COLUMN "pass_bib_from",
DROP COLUMN "pass_bib_to";

-- AlterTable
ALTER TABLE "season_passes" DROP COLUMN "bib_number";

