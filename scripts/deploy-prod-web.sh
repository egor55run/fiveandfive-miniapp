#!/usr/bin/env bash
# Выложить сайт на fiveandfive.kz (только main, совпадающий с GitHub).
# Вся логика и проверки сборки — в deploy-web.sh.
exec "$(dirname "$0")/deploy-web.sh" prod "$@"
