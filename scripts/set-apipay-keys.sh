#!/usr/bin/env bash
# Положить ключ API ApiPay и секрет вебхука в backend/.env на сервере.
#
#   bash scripts/set-apipay-keys.sh staging
#   bash scripts/set-apipay-keys.sh prod
#
# Ввод скрытый, значения уходят на сервер через stdin ssh — их нет ни в
# истории команд, ни в списке процессов, ни в чате.
#
# ВАЖНО для прода: без REGISTRATION_OPEN регистрация открывается сама, как
# только задан ключ (lib/registrationWindow). Поэтому на проде скрипт
# всегда оставляет REGISTRATION_OPEN=false, если там не записано другое, —
# открываем отдельно, по команде владельца «открываем».
set -euo pipefail

HOST="fiveandfive@94.131.93.217"
TARGET="${1:-}"
case "$TARGET" in
  staging) ENV_FILE="staging/backend/.env"; APP="fiveandfive-staging-api"; KEEP_CLOSED=0 ;;
  prod)
    ENV_FILE="fiveandfive/backend/.env"; APP="fiveandfive-api"; KEEP_CLOSED=1
    read -r -p "Боевой ключ ApiPay на ПРОД (регистрация останется закрытой). Введите ДА: " ok
    [ "$ok" = "ДА" ] || { echo "Отменено"; exit 1; }
    ;;
  *) echo "Использование: $0 staging|prod"; exit 1 ;;
esac

# Строка — это одно и то же значение, вставленное несколько раз подряд?
repeated() {
  local s="$1" n=${#1} k
  for ((k = 1; k <= n / 2; k++)); do
    (( n % k == 0 )) || continue
    local part="${s:0:k}" rep=""
    while (( ${#rep} < n )); do rep+="$part"; done
    [ "$rep" = "$s" ] && return 0
  done
  return 1
}

read -r -s -p "Ключ API ApiPay (64 символа, ввод не виден): " KEY; echo
[ -n "$KEY" ] || { echo "Пустой ключ — отменено"; exit 1; }
# Ключ ApiPay — 64 шестнадцатеричных символа (так выглядит ключ песочницы).
# Скрытый ввод легко вставить дважды или с лишним символом — такое отклоняем,
# ничего не записывая.
if ! printf '%s' "$KEY" | LC_ALL=C grep -Eq '^[0-9a-f]{64}$'; then
  echo "Это не похоже на один ключ ApiPay (ожидается 64 символа 0-9 и a-f; вставлено ${#KEY})."
  echo "Возможно, ключ вставился несколько раз или с лишним символом. Ничего не записано — запустите ещё раз."
  echo "Если ApiPay выдал ключ другого вида — скажите, сколько в нём символов (сам ключ не присылайте)."
  exit 1
fi

read -r -s -p "Секрет вебхука ApiPay (ввод не виден; Enter — оставить как есть): " SECRET; echo
if [ -n "$SECRET" ]; then
  if ! printf '%s' "$SECRET" | LC_ALL=C grep -Eq '^[A-Za-z0-9_.~+/=-]{16,128}$'; then
    echo "Это не похоже на один секрет вебхука (ожидается 16–128 символов без пробелов; вставлено ${#SECRET})."
    echo "Ничего не записано — запустите ещё раз и вставьте секрет один раз."
    exit 1
  fi
  if repeated "$SECRET"; then
    echo "Секрет похож на одно значение, вставленное несколько раз (${#SECRET} символов). Ничего не записано."
    exit 1
  fi
  [ "$SECRET" != "$KEY" ] || { echo "Секрет совпадает с ключом API — так не бывает. Ничего не записано."; exit 1; }
fi

# Значения — через stdin ssh, код для сервера — аргументом команды. Там:
# бэкап .env, замена старых значений, на проде — REGISTRATION_OPEN=false,
# если не задан, перезапуск API.
read -r -d '' REMOTE <<'SCRIPT' || true
set -euo pipefail
read -r KEY
read -r SECRET || true
ENV_FILE="$HOME/$ENV_REL"
cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
drop='APIPAY_API_KEY'
[ -n "$SECRET" ] && drop="$drop|APIPAY_WEBHOOK_SECRET"
tmp=$(mktemp)
grep -vE "^($drop)=" "$ENV_FILE" > "$tmp" || true
{
  cat "$tmp"
  echo "APIPAY_API_KEY=$KEY"
  [ -n "$SECRET" ] && echo "APIPAY_WEBHOOK_SECRET=$SECRET"
  if [ "$KEEP_CLOSED" = 1 ] && ! grep -qE '^REGISTRATION_OPEN=' "$tmp"; then
    echo "REGISTRATION_OPEN=false"
  fi
  true
} > "$ENV_FILE"
rm -f "$tmp"
chmod 600 "$ENV_FILE"
cd "$(dirname "$ENV_FILE")"
set -a; . ./.env; set +a
pm2 restart "$APP" --update-env >/dev/null
echo "Записано в ~/$ENV_REL, $APP перезапущен. Значения не выводятся."
echo "REGISTRATION_OPEN=${REGISTRATION_OPEN:-<не задан: открыта, раз есть ключ>}"
[ -n "${APIPAY_WEBHOOK_SECRET:-}" ] && echo "Секрет вебхука: задан" || echo "Секрет вебхука: НЕ задан — вебхуки отклоняются, оплата видна только опросом"
SCRIPT

printf '%s\n%s\n' "$KEY" "$SECRET" |
  ssh "$HOST" "ENV_REL=$ENV_FILE APP=$APP KEEP_CLOSED=$KEEP_CLOSED bash -c $(printf '%q' "$REMOTE")"
