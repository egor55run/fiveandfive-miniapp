-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PromoRedemptionStatus" AS ENUM ('HELD', 'USED', 'RELEASED');

-- AlterTable
ALTER TABLE "seasons" ADD COLUMN     "pass_bib_from" INTEGER,
ADD COLUMN     "pass_bib_to" INTEGER;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "pickup_address" TEXT,
ADD COLUMN     "pickup_place" TEXT,
ADD COLUMN     "theme_accent" TEXT,
ADD COLUMN     "theme_bg_url" TEXT,
ADD COLUMN     "theme_logo_url" TEXT;

-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "bib_number" INTEGER;

-- AlterTable
ALTER TABLE "event_distances" ADD COLUMN     "bib_from" INTEGER,
ADD COLUMN     "bib_to" INTEGER,
ADD COLUMN     "catalog_id" INTEGER;

-- AlterTable
ALTER TABLE "season_passes" ADD COLUMN     "bib_number" INTEGER;

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "event_distance_id" INTEGER;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "base_amount" DECIMAL(10,2),
ADD COLUMN     "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "promo_code_id" INTEGER;

-- CreateTable
CREATE TABLE "distances" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "meters" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bib_reserves" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "bib_from" INTEGER NOT NULL,
    "bib_to" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bib_reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_slots" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "max_uses" INTEGER,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "event_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" SERIAL NOT NULL,
    "promo_code_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "payment_id" INTEGER,
    "registration_id" INTEGER,
    "season_pass_id" INTEGER,
    "base_amount" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL,
    "status" "PromoRedemptionStatus" NOT NULL DEFAULT 'HELD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "distances_label_key" ON "distances"("label");

-- Справочник из уже заведённых дистанций стартов: «5 км» → 5000 м, «500 м» → 500 м.
INSERT INTO "distances" ("label", "meters")
SELECT DISTINCT d."label",
  CASE
    WHEN d."label" ~* '^\s*[0-9]+([.,][0-9]+)?\s*км' THEN round(replace(substring(d."label" from '[0-9]+(?:[.,][0-9]+)?'), ',', '.')::numeric * 1000)::int
    WHEN d."label" ~* '^\s*[0-9]+\s*м' THEN substring(d."label" from '[0-9]+')::int
  END
FROM "event_distances" d;
UPDATE "distances" SET "sort_order" = COALESCE("meters", 1000000);
UPDATE "event_distances" d SET "catalog_id" = c."id" FROM "distances" c WHERE c."label" = d."label";
ALTER TABLE "event_distances" ALTER COLUMN "catalog_id" SET NOT NULL;

-- Результаты — на дистанцию регистрации того же участника на том же старте.
UPDATE "results" r SET "event_distance_id" = g."distance_id"
FROM "registrations" g
WHERE g."user_id" = r."user_id" AND g."event_id" = r."event_id" AND g."distance_id" IS NOT NULL;

-- Промокод — один раз на человека: живое (не освобождённое) использование одно.
CREATE UNIQUE INDEX "promo_redemptions_one_per_user" ON "promo_redemptions"("promo_code_id", "user_id") WHERE "status" <> 'RELEASED';

-- Время и место выдачи одной строкой становится комментарием к выдаче — поле то же.

-- CreateIndex
CREATE INDEX "bib_reserves_event_id_idx" ON "bib_reserves"("event_id");

-- CreateIndex
CREATE INDEX "pickup_slots_event_id_starts_at_idx" ON "pickup_slots"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_code_id_status_idx" ON "promo_redemptions"("promo_code_id", "status");

-- CreateIndex
CREATE INDEX "promo_redemptions_user_id_idx" ON "promo_redemptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_event_id_bib_number_key" ON "registrations"("event_id", "bib_number");

-- CreateIndex
CREATE UNIQUE INDEX "season_passes_season_id_bib_number_key" ON "season_passes"("season_id", "bib_number");

-- AddForeignKey
ALTER TABLE "event_distances" ADD CONSTRAINT "event_distances_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "distances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_event_distance_id_fkey" FOREIGN KEY ("event_distance_id") REFERENCES "event_distances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bib_reserves" ADD CONSTRAINT "bib_reserves_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_slots" ADD CONSTRAINT "pickup_slots_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

