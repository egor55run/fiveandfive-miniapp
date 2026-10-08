-- AlterEnum
ALTER TYPE "LegalDocumentKind" ADD VALUE 'PARENTAL_CONSENT';

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "registration_closes_at" TIMESTAMP(3);
