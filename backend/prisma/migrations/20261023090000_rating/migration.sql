-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('FINISHED', 'DNF', 'DNS', 'DSQ');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hide_from_rating" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "results_published_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "gender_place" INTEGER,
ADD COLUMN     "status" "ResultStatus" NOT NULL DEFAULT 'FINISHED',
ALTER COLUMN "finish_time" DROP NOT NULL,
ALTER COLUMN "place" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_merges" (
    "id" SERIAL NOT NULL,
    "into_user_id" INTEGER NOT NULL,
    "from_user_id" INTEGER NOT NULL,
    "from_label" TEXT NOT NULL,
    "admin_telegram_id" BIGINT NOT NULL,
    "moved" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_merges_pkey" PRIMARY KEY ("id")
);


-- Место среди своего пола для уже внесённых результатов (равные времена делят место).
UPDATE "results" r SET "gender_place" = s.gp
FROM (
  SELECT r2."id", RANK() OVER (PARTITION BY r2."event_id", u."gender" ORDER BY r2."finish_time") AS gp
  FROM "results" r2 JOIN "users" u ON u."id" = r2."user_id"
  WHERE r2."finish_time" IS NOT NULL AND u."gender" IS NOT NULL
) s
WHERE s."id" = r."id";
