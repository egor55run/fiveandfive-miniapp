-- AlterTable
ALTER TABLE "email_notifications" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "html" TEXT,
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "subject" TEXT,
ADD COLUMN     "text" TEXT;

