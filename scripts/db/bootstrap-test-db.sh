#!/usr/bin/env bash
# Разворачивает ЧИСТУЮ тестовую БД: baseline из снапшота + все миграции.
#
# Зачем отдельный скрипт. В db/migrations/ лежат только инкрементальные файлы;
# baseline (000000000000_baseline.sql) по db/migrations/README.md снимается
# pg_dump'ом на целевой машине и в репозиторий не коммитится. Поэтому на пустом
# PostgreSQL apply-migrations.sh упасть обязан — базовых таблиц ещё нет.
#
# Роль baseline здесь играет database/stroyfoto.schema.sql. Он снят ДО обеих
# существующих миграций, поэтому они применяются обычным порядком, без
# --mark-applied.
#
# Снапшот приходится нормализовать: как есть он НЕ исполняется (проверено).
# Генератор scripts/db/export-schema.ts группирует DDL по видам объектов, а не
# по зависимостям, из-за чего:
#   1) FK едет раньше PRIMARY KEY таблицы, на которую ссылается;
#   2) CREATE TRIGGER едет раньше функции set_updated_at(), которую вызывает;
#   3) секция Indexes повторяет индексы, уже созданные UNIQUE-констрейнтами.
# Правки делаются на лету, при загрузке: сам файл авто-генерируемый и его
# нельзя редактировать руками.
#
# Использование:
#   docker compose -f docker-compose.test.yml up -d
#   npm run test:db:setup
#
# Адрес берётся из TEST_DATABASE_URL; по умолчанию — база из
# docker-compose.test.yml.
#
# Предохранители (без них TRUNCATE из тестов однажды уедет в рабочую базу):
#   * имя БД обязано оканчиваться на _test;
#   * TEST_DATABASE_URL обязан отличаться от DATABASE_URL из server/.env.

set -euo pipefail

SNAPSHOT="database/stroyfoto.schema.sql"
PROD_ENV_FILE="server/.env"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Дефолт совпадает с docker-compose.test.yml и с server/test/setup.ts, чтобы
# после `docker compose up -d` всё работало без дополнительной настройки.
TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://stroyfoto:test@localhost:55432/stroyfoto_test}"
[[ -f "$SNAPSHOT" ]] || die "нет снапшота $SNAPSHOT (регенерируется через npm run db:schema:pull)"

# --- предохранитель 1: имя БД ------------------------------------------------
db_name="${TEST_DATABASE_URL##*/}"   # хвост после последнего /
db_name="${db_name%%\?*}"            # без query-строки
case "$db_name" in
  *_test) ;;
  *) die "имя БД '$db_name' не оканчивается на _test — отказываюсь работать" ;;
esac

# --- предохранитель 2: это не рабочая база -----------------------------------
if [[ -f "$PROD_ENV_FILE" ]]; then
  prod_url="$(grep -E '^\s*DATABASE_URL=' "$PROD_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  if [[ -n "$prod_url" && "$prod_url" == "$TEST_DATABASE_URL" ]]; then
    die "TEST_DATABASE_URL совпадает с DATABASE_URL из $PROD_ENV_FILE"
  fi
fi

psql_test() { psql "$TEST_DATABASE_URL" -X -q --set ON_ERROR_STOP=1 "$@"; }

psql_test -c 'SELECT 1' >/dev/null 2>&1 || die "нет соединения с $db_name.
Поднимите тестовый PostgreSQL:  docker compose -f docker-compose.test.yml up -d"

echo "==> Чистим схему public в $db_name"
psql_test -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'

echo "==> Восстанавливаем baseline из $SNAPSHOT"
normalize_snapshot() {
  local constraints
  constraints="$(grep -E '^ALTER TABLE [^;]* ADD CONSTRAINT' "$SNAPSHOT")"

  # Таблицы, типы, расширения и функции — как есть, без констрейнтов,
  # индексов и триггеров: их порядок ниже задаётся явно.
  grep -v -E '^(ALTER TABLE [^;]* ADD CONSTRAINT|CREATE (UNIQUE )?INDEX |CREATE TRIGGER )' "$SNAPSHOT"

  printf '\n-- [bootstrap] PK и UNIQUE раньше ссылающихся на них FK\n'
  printf '%s\n' "$constraints" | grep -E 'PRIMARY KEY|UNIQUE '

  printf '\n-- [bootstrap] затем CHECK и FOREIGN KEY\n'
  printf '%s\n' "$constraints" | grep -v -E 'PRIMARY KEY|UNIQUE '

  # Индексы — ПОСЛЕ констрейнтов и идемпотентно: секция Indexes повторяет
  # индексы, которые UNIQUE-констрейнты уже создали под тем же именем.
  printf '\n-- [bootstrap] индексы после констрейнтов\n'
  grep -E '^CREATE (UNIQUE )?INDEX ' "$SNAPSHOT" \
    | sed -E 's/^CREATE (UNIQUE )?INDEX /CREATE \1INDEX IF NOT EXISTS /'

  printf '\n-- [bootstrap] триггеры после функций, которые они вызывают\n'
  grep -E '^CREATE TRIGGER ' "$SNAPSHOT"
}
# NOTICE про пропущенные индексы ожидаемы (см. пункт 3 в шапке) — глушим.
PGOPTIONS='-c client_min_messages=warning' \
  normalize_snapshot | psql_test --single-transaction -f - >/dev/null

echo "==> Применяем миграции db/migrations/"
DATABASE_URL="$TEST_DATABASE_URL" \
STROYFOTO_LOCK="${STROYFOTO_LOCK:-${TMPDIR:-/tmp}/stroyfoto-test-migrate.lock}" \
  bash scripts/db/apply-migrations.sh

echo "==> Готово. Таблиц в public: $(psql_test -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
