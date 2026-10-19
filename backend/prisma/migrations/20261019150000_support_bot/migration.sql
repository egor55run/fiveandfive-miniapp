-- CreateTable
CREATE TABLE "support_states" (
    "telegram_id" BIGINT NOT NULL,
    "mode" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_states_pkey" PRIMARY KEY ("telegram_id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "admin_chat_id" BIGINT,
    "admin_message_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_messages_admin_chat_id_admin_message_id_idx" ON "support_messages"("admin_chat_id", "admin_message_id");

-- CreateIndex
CREATE INDEX "support_messages_telegram_id_created_at_idx" ON "support_messages"("telegram_id", "created_at");

