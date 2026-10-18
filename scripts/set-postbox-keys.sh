#!/usr/bin/env bash
# Положить ключ Yandex Cloud Postbox (API-ключ сервисного аккаунта, scope
# yc.postbox.send) в backend/.env на сервере и включить письма.
#
#   bash scripts/set-postbox-keys.sh staging
#
# Ключ вводится скрыто и уходит на сервер через stdin ssh — его нет ни в
# истории команд, ни в списке процессов, ни в чате. На прод — только по
# решению владельца (юрист: трансграничная передача), поэтому prod требует
# отдельного подтверждения.
set -euo pipefail

HOST="fiveandfive@94.131.93.217"
TARGET="${1:-}"
case "$TARGET" in
  staging) ENV_FILE="staging/backend/.env"; APP="fiveandfive-staging-api" ;;
  prod)
    ENV_FILE="fiveandfive/backend/.env"; APP="fiveandfive-api"
    read -r -p "Письма на ПРОДЕ: юрист согласовал передачу в Postbox (регион Россия)? Введите ДА: " ok
    [ "$ok" = "ДА" ] || { echo "Отменено"; exit 1; }
    ;;
  *) echo "Использование: $0 staging|prod"; exit 1 ;;
esac

read -r -p "ID API-ключа (идентификатор, начинается с aje…): " KEY_ID
read -r -s -p "Секретная часть API-ключа (ввод не виден): " KEY_SECRET; echo
[ -n "$KEY_ID" ] && [ -n "$KEY_SECRET" ] || { echo "Пустой ключ — отменено"; exit 1; }

# Ключ — через stdin ssh (две строки: id, секрет), код для сервера — аргументом
# команды. Там: бэкап .env, замена старых значений, перезапуск API.
read -r -d '' REMOTE <<'SCRIPT' || true
set -euo pipefail
read -r KEY_ID; read -r KEY_SECRET
ENV_FILE="$HOME/$ENV_REL"
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
tmp=$(mktemp)
grep -vE '^(EMAIL_ENABLED|POSTBOX_SMTP_USER|POSTBOX_SMTP_PASSWORD)=' "$ENV_FILE" > "$tmp" || true
{
  cat "$tmp"
  echo "EMAIL_ENABLED=true"
  echo "POSTBOX_SMTP_USER=$KEY_ID"
  echo "POSTBOX_SMTP_PASSWORD=$KEY_SECRET"
} > "$ENV_FILE"
rm -f "$tmp"
chmod 600 "$ENV_FILE"
cd "$(dirname "$ENV_FILE")"
set -a; . ./.env; set +a
pm2 restart "$APP" --update-env >/dev/null
echo "Ключ записан в ~/$ENV_REL, $APP перезапущен. Значения не выводятся."
SCRIPT

printf '%s\n%s\n' "$KEY_ID" "$KEY_SECRET" |
  ssh "$HOST" "ENV_REL=$ENV_FILE APP=$APP bash -c $(printf '%q' "$REMOTE")"
