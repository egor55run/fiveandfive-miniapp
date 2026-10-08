#!/usr/bin/env bash
# Собрать сайт (Next.js) на этой машине и выложить на сервер.
#
#   scripts/deploy-web.sh staging   — staging.fiveandfive.kz (любая ветка, кроме main)
#   scripts/deploy-web.sh prod      — fiveandfive.kz (только main, совпадающий с GitHub)
#
# Собираем не на сервере: там 2 ГБ памяти без swap, и next build рядом с
# продом рискует разбудить OOM-killer. На сервер уезжает готовый
# .next/standalone (+ static и public) в <dir>/releases/<UTC>-<rev>, ссылка
# <dir>/current переключается на него, pm2-процесс перезапускается (пара
# секунд). Последние 3 сборки остаются для отката: ln -sfn на нужную + тот же
# pm2 start. nginx скрипт не трогает.
set -euo pipefail

HOST="fiveandfive@94.131.93.217"
TARGET="${1:-}"

case "$TARGET" in
  staging)
    REMOTE_DIR="staging-web"; APP="fiveandfive-staging-web"; PORT=3101
    # Staging обслуживает тестовый бот: его имя видно на экране «Откройте в
    # Telegram» и нужно виджету входа в админку (см. src/lib/telegram.ts).
    BOT="fiveandfive_test_bot"
    # Казахские версии оферты/политики/бланка — пока только на staging:
    # их ещё проверяет юрист (решение пользователя 2026-10-08).
    LEGAL_KK=1
    ;;
  prod)
    REMOTE_DIR="web"; APP="fiveandfive-web"; PORT=3001
    BOT="fiveandfive_run_bot"
    # На прод казахские версии — только по явной команде пользователя.
    LEGAL_KK=0
    ;;
  *) echo "Использование: $0 staging|prod"; exit 1 ;;
esac

cd "$(dirname "$0")/.."
branch=$(git branch --show-current)
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!! Есть незакоммиченные изменения — на сервере должна быть ровно ветка"; exit 1
fi
if [ "$TARGET" = prod ]; then
  [ "$branch" = main ] || { echo "!! На прод — только main (сейчас: $branch)"; exit 1; }
  git fetch --quiet origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || {
    echo "!! Локальный main не совпадает с origin/main — сначала git push (или pull)"; exit 1; }
else
  [ "$branch" != main ] || { echo "!! main — прод-ветка, на staging не выкладываем"; exit 1; }
fi
rev=$(git rev-parse --short HEAD)

echo "==> next build ($TARGET: $branch @ $rev, бот @$BOT)"
rm -rf .next
NEXT_PUBLIC_BOT_USERNAME="$BOT" NEXT_PUBLIC_LEGAL_KK="$LEGAL_KK" npm run build

# Проверки готовой сборки — до того, как она уедет на сервер.
static=.next/static
grep -rqF "$BOT" "$static" || { echo "!! В сборке нет @$BOT"; exit 1; }
if [ "$TARGET" = prod ]; then
  if grep -rqF "fiveandfive_test_bot" "$static"; then
    echo "!! В прод-сборку попал тестовый бот"; exit 1
  fi
  # Писем участникам пока нет — экран успеха не должен обещать их
  # (правило 2026-10-08; вернуть строку, когда подключим почту).
  if grep -rqF "Детали отправили на" "$static"; then
    echo "!! В прод-сборке есть «Детали отправили на почту», а почта не подключена"; exit 1
  fi
  # Казахские тексты документов ещё не проверены юристом — на прод не пускаем.
  # «ЖК «5&5»» есть во всех трёх казахских документах и только в них.
  if grep -rqF "ЖК «5&5»" .next/server .next/static; then
    echo "!! В прод-сборку попали казахские версии документов — они только для staging"; exit 1
  fi
fi

release=$(mktemp -d)
trap 'rm -rf "$release"' EXIT
cp -r .next/standalone/. "$release/"
mkdir -p "$release/.next"
cp -r .next/static "$release/.next/static"
cp -r public "$release/public"
# Нативный sharp собран под ОС этой машины, а нужен он только оптимизатору
# картинок /_next/image, которым сайт не пользуется.
rm -rf "$release/node_modules/@img" "$release/node_modules/sharp"
echo "$branch $rev" > "$release/REVISION"

name="$(date -u +%Y%m%dT%H%M%SZ)-$rev"
echo "==> upload $name"
tar -C "$release" -czf - . | ssh "$HOST" "set -e
  mkdir -p ~/$REMOTE_DIR/releases/$name
  # Часы машины разработчика могут спешить — без шума про «время в будущем».
  tar -C ~/$REMOTE_DIR/releases/$name --warning=no-timestamp -xzf -
  ln -sfn ~/$REMOTE_DIR/releases/$name ~/$REMOTE_DIR/current
  ls -1dt ~/$REMOTE_DIR/releases/* | tail -n +4 | xargs -r rm -rf
  cd ~/$REMOTE_DIR/current
  pm2 delete $APP >/dev/null 2>&1 || true
  PORT=$PORT HOSTNAME=127.0.0.1 NODE_ENV=production pm2 start server.js --name $APP --time --cwd ~/$REMOTE_DIR/current >/dev/null
  pm2 save --force >/dev/null
  sleep 3
  echo \"==> $APP: \$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/app) (\$(cat REVISION))\""
