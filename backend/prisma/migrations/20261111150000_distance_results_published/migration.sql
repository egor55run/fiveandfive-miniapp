-- AlterTable
ALTER TABLE "event_distances" ADD COLUMN     "results_published_at" TIMESTAMP(3);


-- Уже опубликованные старты: все их дистанции считаются опубликованными тогда же.
UPDATE "event_distances" d SET "results_published_at" = e."results_published_at" FROM "events" e WHERE e."id" = d."event_id" AND e."results_published_at" IS NOT NULL;
