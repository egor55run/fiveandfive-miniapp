#!/usr/bin/env bash
# Положить ключ API Brevo в backend/.env на сервере и включить письма.
#
#   bash scripts/set-email-key.sh staging
#
# Ключ вводится скрыто и уходит на сервер через stdin ssh — его нет ни в
# истории команд, ни в списке процессов, ни в чате. На прод — только по
# решению владельца (юрист: передача адреса и имени в Brevo, Франция),
# поэтому prod требует отдельного подтверждения.
set -euo pipefail

HOST="fiveandfive@94.131.93.217"
TARGET="${1:-}"
case "$TARGET" in
  staging) ENV_FILE="staging/backend/.env"; APP="fiveandfive-staging-api" ;;
  prod)
    ENV_FILE="fiveandfive/backend/.env"; APP="fiveandfive-api"
    read -r -p "Письма на ПРОДЕ: юрист согласовал передачу в Brevo (Франция)? Введите ДА: " ok
    [ "$ok" = "ДА" ] || { echo "Отменено"; exit 1; }
    ;;
  *) echo "Использование: $0 staging|prod"; exit 1 ;;
esac

read -r -s -p "Ключ API Brevo (начинается с xkeysib-, ввод не виден): " KEY; echo
[ -n "$KEY" ] || { echo "Пустой ключ — отменено"; exit 1; }
case "$KEY" in xkeysib-*) ;; *) echo "Похоже, это не ключ API v3 (должен начинаться с xkeysib-) — отменено"; exit 1 ;; esac

# Ключ — через stdin ssh, код для сервера — аргументом команды. Там: бэкап
# .env, замена старых значений (и следов Postbox), перезапуск API.
read -r -d '' REMOTE <<'SCRIPT' || true
set -euo pipefail
read -r KEY
ENV_FILE="$HOME/$ENV_REL"
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
tmp=$(mktemp)
grep -vE '^(EMAIL_ENABLED|BREVO_API_KEY|POSTBOX_SMTP_USER|POSTBOX_SMTP_PASSWORD)=' "$ENV_FILE" > "$tmp" || true
{
  cat "$tmp"
  echo "EMAIL_ENABLED=true"
  echo "BREVO_API_KEY=$KEY"
} > "$ENV_FILE"
rm -f "$tmp"
chmod 600 "$ENV_FILE"
cd "$(dirname "$ENV_FILE")"
set -a; . ./.env; set +a
pm2 restart "$APP" --update-env >/dev/null
echo "Ключ записан в ~/$ENV_REL, $APP перезапущен. Значение не выводится."
SCRIPT

printf '%s\n' "$KEY" |
  ssh "$HOST" "ENV_REL=$ENV_FILE APP=$APP bash -c $(printf '%q' "$REMOTE")"
