#!/usr/bin/env bash
# Применяет все db/migrations/*.sql к DATABASE_URL по алфавиту имени.
# Использование:
#   DATABASE_URL="postgres://user:pass@host:6432/db?sslmode=verify-full" \
#     bash scripts/db/apply-migrations.sh
#
# Опции:
#   --dir <path>   директория с миграциями (по умолчанию db/migrations)
#   --dry-run      вывести список миграций без применения

set -euo pipefail

MIGRATIONS_DIR="db/migrations"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      MIGRATIONS_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  echo "Usage: DATABASE_URL=postgres://... bash $0" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed or not in PATH" >&2
  exit 1
fi

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi

# Собираем список .sql-файлов в алфавитном порядке (LC_ALL=C для стабильности).
mapfile -t MIGRATIONS < <(LC_ALL=C find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "No .sql files in $MIGRATIONS_DIR — nothing to apply." >&2
  exit 0
fi

echo "Found ${#MIGRATIONS[@]} migration(s) in $MIGRATIONS_DIR:"
for f in "${MIGRATIONS[@]}"; do
  echo "  - $f"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "DRY-RUN: ничего не применяем."
  exit 0
fi

# Скрываем DATABASE_URL из логов: маскируем пароль.
SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#://([^:]+):[^@]+@#://\1:****@#')"
echo "Target database: $SAFE_URL"
echo

for f in "${MIGRATIONS[@]}"; do
  echo "=== Applying $f ==="
  psql "$DATABASE_URL" \
    --set ON_ERROR_STOP=1 \
    --single-transaction \
    --quiet \
    --file "$f"
  echo "    OK: $f"
  echo
done

echo "All migrations applied successfully."
