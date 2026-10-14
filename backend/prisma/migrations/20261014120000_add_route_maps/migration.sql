-- CreateTable
CREATE TABLE "event_route_maps" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_route_maps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_route_maps_event_id_idx" ON "event_route_maps"("event_id");

-- AddForeignKey
ALTER TABLE "event_route_maps" ADD CONSTRAINT "event_route_maps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Данные: прежняя единственная карта старта становится первой картой с
-- подписью-дистанцией старта («5 км»).
INSERT INTO "event_route_maps" ("event_id", "url", "caption", "sort_order")
SELECT "id", "route_image_url", "distance", 0 FROM "events" WHERE "route_image_url" IS NOT NULL;
