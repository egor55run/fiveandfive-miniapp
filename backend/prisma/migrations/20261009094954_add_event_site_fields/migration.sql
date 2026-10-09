-- AlterTable
ALTER TABLE "events" ADD COLUMN     "program" TEXT,
ADD COLUMN     "regulations_url" TEXT,
ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

