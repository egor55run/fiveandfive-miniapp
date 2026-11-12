-- Итоги сезона (2026-11-12).
ALTER TABLE "seasons" ADD COLUMN "summary_published_at" TIMESTAMP(3);
ALTER TABLE "seasons" ADD COLUMN "summary" JSONB;
ALTER TYPE "NotificationKind" ADD VALUE 'SEASON_SUMMARY';
