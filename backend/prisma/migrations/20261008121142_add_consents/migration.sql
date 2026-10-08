-- CreateEnum
CREATE TYPE "LegalDocumentKind" AS ENUM ('OFERTA', 'PRIVACY');

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" SERIAL NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "document_id" INTEGER NOT NULL,
    "registration_id" INTEGER,
    "season_pass_id" INTEGER,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_kind_version_key" ON "legal_documents"("kind", "version");

-- CreateIndex
CREATE INDEX "consents_user_id_idx" ON "consents"("user_id");

-- CreateIndex
CREATE INDEX "consents_registration_id_idx" ON "consents"("registration_id");

-- CreateIndex
CREATE INDEX "consents_season_pass_id_idx" ON "consents"("season_pass_id");

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_season_pass_id_fkey" FOREIGN KEY ("season_pass_id") REFERENCES "season_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
