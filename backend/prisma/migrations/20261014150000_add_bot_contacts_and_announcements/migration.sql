-- CreateTable
CREATE TABLE "bot_contacts" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "first_name" TEXT,
    "username" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMP(3),
    "blocked_at" TIMESTAMP(3),

    CONSTRAINT "bot_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "race_announcements" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "race_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_contacts_telegram_id_key" ON "bot_contacts"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "race_announcements_event_id_telegram_id_key" ON "race_announcements"("event_id", "telegram_id");

-- AddForeignKey
ALTER TABLE "race_announcements" ADD CONSTRAINT "race_announcements_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Данные: подписчики «узнать об открытии» уже писали боту — они первые в
-- списке тех, кому бот может писать. Отписавшиеся (/stop) — с отметкой.
INSERT INTO "bot_contacts" ("telegram_id", "first_name", "username", "first_seen_at", "last_seen_at", "stopped_at")
SELECT "telegram_id", "first_name", "username", "subscribed_at", COALESCE("unsubscribed_at", "subscribed_at"), "unsubscribed_at"
FROM "opening_subscribers"
ON CONFLICT ("telegram_id") DO NOTHING;
