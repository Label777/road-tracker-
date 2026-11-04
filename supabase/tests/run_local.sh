#!/usr/bin/env bash
# Поднимает временный PostgreSQL, применяет шим Supabase + миграции и запускает тесты.
# Требуется PostgreSQL 15+ (initdb/pg_ctl в PATH или PGBIN).
set -euo pipefail
shopt -s nullglob
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # postgres не запускается от root
  id -u pgtest >/dev/null 2>&1 || useradd -M pgtest
  chown pgtest "$TMP"
  RUN_AS=(runuser -u pgtest --)
fi
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A)
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase_shim.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$m"
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/schema_test.sql" 2>&1 | sed -e 's/^psql:[^ ]* //' -e 's/^NOTICE:  //' | grep -v '^$'
