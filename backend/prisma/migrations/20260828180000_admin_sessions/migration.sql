-- Сессии администратора для /admin. Пароля в системе нет: личность подтверждает
-- Telegram, а эта таблица хранит выданные сессии, чтобы их можно было отозвать.
-- В token_hash лежит sha256 от токена, а не сам токен.

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_hash_key" ON "admin_sessions"("token_hash");
