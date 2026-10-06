# 5&5 — фронтенд

Next.js (App Router) в корне репозитория, бэкенд на Fastify — в `backend/`
(см. `backend/README.md`).

## Структура

У каждой части свой корневой layout (route groups), поэтому SDK Telegram,
стили Mini App и админки друг в друга не протекают:

| Путь | Что это | Рендер |
|---|---|---|
| `src/app/(tg)/app` | Telegram Mini App (`src/App.tsx` и `src/components`) | только в браузере |
| `src/app/(admin)/admin` | админка (`src/admin`) | только в браузере |

Пока сайта нет, `/` отдаёт Mini App через rewrite в `next.config.ts` —
на корень смотрит кнопка в BotFather. Когда появится главная сайта, rewrite
уйдёт, а адрес Mini App в BotFather сменится на `/app`.

## Запуск

```bash
npm install
npm run dev      # http://localhost:5173, API — http://localhost:3000
npm run build
npm run start    # прод-сервер на :3001
npm run lint
```

Адрес API — `NEXT_PUBLIC_API_URL` (`.env.example`). В прод-сборке это `/api`
из `.env.production`: nginx проксирует `/api/` на бэкенд, CORS не участвует.
Значение вшивается в бандл при сборке, поэтому после смены нужна пересборка.
