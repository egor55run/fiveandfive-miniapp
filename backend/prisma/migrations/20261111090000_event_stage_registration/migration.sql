-- AlterTable
ALTER TABLE "events" ADD COLUMN     "registration_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stage_number" INTEGER,
ADD COLUMN     "visible" BOOLEAN NOT NULL DEFAULT true;


-- Этапы серии: номера по дате внутри сезона; их регистрация — как была
-- (открыта вместе с общим переключателем). Отдельные старты — закрыты, пока
-- в админке не включат им свой переключатель.
UPDATE "events" e SET "stage_number" = n.rn
FROM (SELECT "id", row_number() OVER (PARTITION BY "season_id" ORDER BY "date") AS rn FROM "events" WHERE "season_id" IS NOT NULL) n
WHERE n."id" = e."id";
UPDATE "events" SET "registration_enabled" = true WHERE "season_id" IS NOT NULL;
