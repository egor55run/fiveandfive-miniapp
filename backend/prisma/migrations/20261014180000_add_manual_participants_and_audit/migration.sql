-- AlterTable
ALTER TABLE "registrations" ADD COLUMN     "manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manual_note" TEXT;

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" SERIAL NOT NULL,
    "admin_telegram_id" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "event_id" INTEGER,
    "registration_id" INTEGER,
    "user_id" INTEGER,
    "subject" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_event_id_created_at_idx" ON "admin_audit_log"("event_id", "created_at");

