#!/usr/bin/env bash
# Собрать сайт (Next.js) на этой машине и выложить на staging.fiveandfive.kz.
#
#   scripts/deploy-staging-web.sh
#
# Собираем не на сервере: там 2 ГБ памяти без swap, и next build рядом с
# продом рискует разбудить OOM-killer. На сервер уезжает готовый
# .next/standalone (+ static и public), процесс fiveandfive-staging-web
# перезапускается. Бэкенд staging выкладывается отдельно: ~/deploy-staging.sh.
set -euo pipefail

HOST="fiveandfive@94.131.93.217"
REMOTE_DIR="staging-web"
APP="fiveandfive-staging-web"

cd "$(dirname "$0")/.."
branch=$(git branch --show-current)
[ "$branch" != main ] || { echo "!! main — прод-ветка, на staging не выкладываем"; exit 1; }
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!! Есть незакоммиченные изменения — staging должен совпадать с веткой"; exit 1
fi
rev=$(git rev-parse --short HEAD)

echo "==> next build ($branch @ $rev)"
rm -rf .next
npm run build

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
  tar -C ~/$REMOTE_DIR/releases/$name -xzf -
  ln -sfn ~/$REMOTE_DIR/releases/$name ~/$REMOTE_DIR/current
  # Последние 3 сборки оставляем для отката (ln -sfn на нужную + рестарт).
  ls -1dt ~/$REMOTE_DIR/releases/* | tail -n +4 | xargs -r rm -rf
  cd ~/$REMOTE_DIR/current
  pm2 delete $APP >/dev/null 2>&1 || true
  PORT=3101 HOSTNAME=127.0.0.1 NODE_ENV=production pm2 start server.js --name $APP --time --cwd ~/$REMOTE_DIR/current >/dev/null
  pm2 save --force >/dev/null
  sleep 3
  echo \"==> web: \$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/app) (\$(cat REVISION))\""
