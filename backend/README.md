# FIVE&FIVE — Backend

Fastify + Prisma + PostgreSQL.

## Требования
- Node.js 20+
- PostgreSQL 16 (локально проще всего через Docker — см. ниже)

## Быстрый старт (локально)

```bash
cd backend
npm install

# 1. Поднять PostgreSQL
docker compose up -d

# 2. Применить миграции + сгенерировать клиент + засеять данные
npm run prisma:migrate      # создаст миграции и таблицы
npm run db:seed             # добавит демо-старты

# 3. Запустить API (hot-reload)
npm run dev
```

API поднимется на `http://localhost:3000`.

## Эндпоинты
| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/health` | статус сервиса + проверка БД |
| GET | `/events` | список стартов |
| GET | `/events/:id` | один старт |
| POST | `/registrations` | регистрация на старт (оплата — заглушка) |

Пример регистрации:
```bash
curl -X POST http://localhost:3000/registrations \
  -H 'Content-Type: application/json' \
  -d '{"eventId":1,"firstName":"Егор","lastName":"Кадыров","email":"e@example.com","age":28,"phone":"+77000000000"}'
```

## Скрипты
- `npm run dev` — dev-сервер (tsx watch)
- `npm run build` / `npm start` — прод-сборка и запуск
- `npm run prisma:migrate` — миграции (dev)
- `npm run prisma:studio` — GUI для БД
- `npm run db:seed` — сид демо-данных
