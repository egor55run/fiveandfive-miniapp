-- Telegram Mini App: личность пользователя приходит из подписанного initData,
-- поэтому идентификатором становится telegram_id, а не email.

-- email больше не идентификатор: два Telegram-аккаунта вправе указать один email.
-- DropIndex
DROP INDEX "users_email_key";

-- username из Telegram; email/age/phone заполняются только при регистрации
-- на старт, а пользователь создаётся раньше — при первом открытии приложения.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT,
ALTER COLUMN "last_name" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "age" DROP NOT NULL,
ALTER COLUMN "phone" DROP NOT NULL;
