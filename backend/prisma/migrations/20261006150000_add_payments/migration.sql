-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('REGISTRATION', 'SEASON_PASS');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('CREATED', 'PENDING', 'PAID', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "registration_id" INTEGER,
    "season_pass_id" INTEGER,
    "amount" DECIMAL(10,2) NOT NULL,
    "phone" TEXT NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'CREATED',
    "provider_invoice_id" INTEGER,
    "provider_status" TEXT,
    "error" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_invoice_id_key" ON "payments"("provider_invoice_id");

-- CreateIndex
CREATE INDEX "payments_state_expires_at_idx" ON "payments"("state", "expires_at");

-- CreateIndex
CREATE INDEX "payments_registration_id_idx" ON "payments"("registration_id");

-- CreateIndex
CREATE INDEX "payments_season_pass_id_idx" ON "payments"("season_pass_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_season_pass_id_fkey" FOREIGN KEY ("season_pass_id") REFERENCES "season_passes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
