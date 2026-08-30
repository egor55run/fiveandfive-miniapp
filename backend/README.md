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
- `npm run job:reminders` — разослать напоминания за 3 дня до старта (см. ниже)

## Уведомления участникам

Отправляются в Telegram тем же `BOT_TOKEN`, которым проверяются подписи initData.
Три вида: регистрация на старт (и отдельное сообщение на абонемент), внесённый
результат, напоминание за 3 дня.

**Ограничение платформы.** Бот не может написать первым тому, кто не открывал с
ним диалог. Ответ при этом разный: `403 bot can't initiate conversation` если
Telegram про такой чат знает, и `400 Bad Request: chat not found` если не знает
вовсе. Первый случай пишется в журнал как `BLOCKED` и не повторяется, второй —
как `FAILED`, то есть попытка повторится (и это верно: человек мог нажать Start
уже после регистрации).

Статусы в таблице `notifications`: `SENT`, `BLOCKED`, `FAILED` (сеть, 5xx,
`chat not found` — повторится на следующем прогоне), `SKIPPED` (рассылка
выключена или у пользователя нет `telegram_id`). Посмотреть, до кого не доходит:

```sql
select status, count(*) from notifications group by status;
```

Выключатель — `NOTIFY_ENABLED` (см. `.env.example`). По умолчанию рассылка живёт
только при `NODE_ENV=production`, поэтому локальная разработка никому не пишет.

### Напоминания по расписанию

Джоба — обычный одноразовый скрипт (`src/jobs/runRaceReminders.ts`), планировщик
снаружи. На сервере это pm2 cron, `0 4 * * *` = 09:00 по Астане:

```bash
cd ~/fiveandfive/backend
# ОБЯЗАТЕЛЬНО: pm2 берёт переменные из текущей оболочки, а НЕ из .env. Без
# этой строки джоба поднимется без DATABASE_URL и BOT_TOKEN. Так же поступает
# deploy-backend.sh перед запуском API.
set -a; . ./.env; set +a

pm2 start dist/jobs/runRaceReminders.js --name fiveandfive-reminders \
  --no-autorestart --cron "0 4 * * *"
pm2 save
```

`--no-autorestart` обязателен: скрипт завершается сам, и без этого флага pm2
поднимал бы его в цикле. В `pm2 list` такая джоба между прогонами висит со
статусом `stopped` — это норма, а не поломка.

`pm2 start` запускает скрипт сразу, не только по расписанию. Перед регистрацией
стоит убедиться, что в ближайшие 3 дня стартов нет, иначе рассылка уйдёт прямо
в момент настройки.

Уже настроенные `pm2 startup systemd` + `pm2 save` переживают перезагрузку.

- прогон вручную: `pm2 restart fiveandfive-reminders`
- логи: `pm2 logs fiveandfive-reminders --lines 20 --nostream`
- сухой прогон без отправки: `NOTIFY_ENABLED=false npm run job:reminders`

Повторные запуски безопасны — отправленные напоминания отсеиваются по журналу,
поэтому лишний прогон ничего не дублирует.

> `deploy-backend.sh` про эту джобу не знает: он перезапускает только
> `fiveandfive-api`. Регистрировать её нужно один раз вручную (команда выше);
> при пересоздании pm2-процессов не забыть про неё.

### Включить или выключить рассылку на работающем проде

`NOTIFY_ENABLED` читается из окружения процесса, поэтому правки `.env` без
перезапуска ничего не меняют:

```bash
cd ~/fiveandfive/backend
sed -i 's/^NOTIFY_ENABLED=.*/NOTIFY_ENABLED=true/' .env   # или false
set -a; . ./.env; set +a
pm2 restart fiveandfive-api --update-env
pm2 env 0 | grep NOTIFY_ENABLED    # проверить, что подхватилось
```
