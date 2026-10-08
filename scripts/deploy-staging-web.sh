#!/usr/bin/env bash
# Выложить сайт на staging.fiveandfive.kz. Вся логика — в deploy-web.sh.
exec "$(dirname "$0")/deploy-web.sh" staging "$@"
