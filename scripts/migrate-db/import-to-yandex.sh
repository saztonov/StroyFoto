#!/usr/bin/env bash
# import-to-yandex.sh
# Импорт CSV (созданных export-from-supabase.sh) в Yandex Managed PostgreSQL.
#
# Использование:
#   YANDEX_DB_URL="postgres://...:6432/db?sslmode=verify-full" \
#     bash scripts/migrate-db/import-to-yandex.sh [<export-dir>]
#
# Опции:
#   --skip-validate        не запускать validate-target.sql после импорта
#   -h, --help             помощь
#
# Env:
#   YANDEX_DB_URL          обязательно — connection string цели
#   EXPORT_DIR             альтернатива позиционному <export-dir>
#   ALLOW_NON_EMPTY_TARGET 1 — пропустить guard на непустые таблицы (без prompt)
#
# Поведение:
#   * Pre-checks: psql, env, export-dir + 11 CSV, 001_init.sql применён,
#     target пустой (или ALLOW_NON_EMPTY_TARGET=1 / интерактивное "y").
#   * Импорт в одной транзакции (--single-transaction). Любая FK/PK ошибка
#     → ROLLBACK всего импорта, БД остаётся в исходном состоянии.
#   * Триггеры set_updated_at не отключаются: они BEFORE UPDATE, а \copy
#     делает INSERT — значения updated_at из CSV сохраняются.
#   * Post-checks: validate-target.sql (RAISE EXCEPTION на orphans/storage).

set -euo pipefail

SKIP_VALIDATE=0
ARG_EXPORT_DIR=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

EXPECTED_CSVS=(
  app_users.csv
  profiles.csv
  projects.csv
  project_memberships.csv
  work_types.csv
  work_assignments.csv
  performers.csv
  plans.csv
  reports.csv
  report_plan_marks.csv
  report_photos.csv
)

# Колонки для каждой таблицы — должны точно совпадать с порядком в экспортированных CSV.
declare -A COLUMNS=(
  [app_users]="id,email,password_hash,password_must_reset,created_at,updated_at"
  [profiles]="id,full_name,role,is_active,created_at,updated_at"
  [projects]="id,name,description,created_by,created_at,updated_at"
  [project_memberships]="project_id,user_id,created_at"
  [work_types]="id,name,is_active,created_by,created_at"
  [work_assignments]="id,name,is_active,created_by,created_at"
  [performers]="id,name,kind,is_active,created_at"
  [plans]="id,project_id,name,r2_key,page_count,uploaded_by,created_at,floor,building,section,updated_at,storage"
  [reports]="id,project_id,work_type_id,performer_id,plan_id,author_id,description,taken_at,created_at,updated_at,work_assignment_id"
  [report_plan_marks]="id,report_id,plan_id,page,x_norm,y_norm,created_at"
  [report_photos]="id,report_id,r2_key,thumb_r2_key,width,height,taken_at,created_at,storage"
)

# Порядок импорта (FK-зависимости).
IMPORT_ORDER=(
  app_users
  profiles
  projects
  project_memberships
  work_types
  work_assignments
  performers
  plans
  reports
  report_plan_marks
  report_photos
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-validate)
      SKIP_VALIDATE=1
      shift
      ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      if [[ -n "$ARG_EXPORT_DIR" ]]; then
        echo "Unexpected positional argument: $1" >&2
        exit 2
      fi
      ARG_EXPORT_DIR="$1"
      shift
      ;;
  esac
done

if [[ -z "${YANDEX_DB_URL:-}" ]]; then
  echo "ERROR: YANDEX_DB_URL is not set" >&2
  echo "Usage: YANDEX_DB_URL=postgres://... bash $0 [<export-dir>]" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed or not in PATH" >&2
  exit 1
fi

# Определяем export-dir.
if [[ -n "$ARG_EXPORT_DIR" ]]; then
  EXPORT_DIR="$ARG_EXPORT_DIR"
elif [[ -n "${EXPORT_DIR:-}" ]]; then
  : # уже задана
else
  echo "ERROR: export-dir is not specified" >&2
  echo "       Pass as positional arg or set EXPORT_DIR env var." >&2
  exit 1
fi

if [[ ! -d "$EXPORT_DIR" ]]; then
  echo "ERROR: export-dir does not exist: $EXPORT_DIR" >&2
  exit 1
fi

EXPORT_DIR_ABS="$(cd "$EXPORT_DIR" && pwd)"

# Проверка наличия всех CSV.
MISSING=()
for csv in "${EXPECTED_CSVS[@]}"; do
  if [[ ! -f "$EXPORT_DIR_ABS/$csv" ]]; then
    MISSING+=("$csv")
  fi
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: missing CSV files in $EXPORT_DIR_ABS:" >&2
  for f in "${MISSING[@]}"; do echo "  - $f" >&2; done
  exit 1
fi

SAFE_URL="$(printf '%s' "$YANDEX_DB_URL" | sed -E 's#://([^:]+):[^@]+@#://\1:****@#')"
echo "Target  : $SAFE_URL"
echo "Source  : $EXPORT_DIR_ABS"
echo

# Pre-check: 001_init применён. Считаем не только наличие таблиц, но и ключевых
# колонок, чтобы ловить частично применённые / устаревшие схемы.
SCHEMA_OK=$(psql "$YANDEX_DB_URL" \
  --set ON_ERROR_STOP=1 \
  --tuples-only --no-align \
  -c "select count(*) from information_schema.columns
      where table_schema='public' and (
        (table_name='app_users'           and column_name in ('id','email','password_hash','password_must_reset')) or
        (table_name='profiles'            and column_name in ('id','role','is_active')) or
        (table_name='projects'            and column_name in ('id','name','created_at')) or
        (table_name='project_memberships' and column_name in ('project_id','user_id')) or
        (table_name='work_types'          and column_name in ('id','name','is_active')) or
        (table_name='work_assignments'    and column_name in ('id','name','is_active')) or
        (table_name='performers'          and column_name in ('id','name','kind')) or
        (table_name='plans'               and column_name in ('id','project_id','storage')) or
        (table_name='reports'             and column_name in ('id','project_id','work_assignment_id')) or
        (table_name='report_plan_marks'   and column_name in ('id','report_id','plan_id')) or
        (table_name='report_photos'       and column_name in ('id','report_id','storage'))
      );")

# Сумма ожидаемых колонок: 4+3+3+2+3+3+3+3+3+3+3 = 33
EXPECTED_COLS=33
if [[ "${SCHEMA_OK// /}" != "$EXPECTED_COLS" ]]; then
  echo "ERROR: schema check failed (got $SCHEMA_OK columns, expected $EXPECTED_COLS)" >&2
  echo "       Apply db/migrations/001_init.sql first:" >&2
  echo "         DATABASE_URL=\$YANDEX_DB_URL bash scripts/db/apply-migrations.sh" >&2
  exit 1
fi
echo "schema check: OK"

# Pre-check: target пустой (либо confirm/ALLOW_NON_EMPTY_TARGET).
COUNTS_OUTPUT=$(psql "$YANDEX_DB_URL" \
  --set ON_ERROR_STOP=1 \
  --tuples-only --no-align --field-separator='|' \
  -c "
    select 'app_users',           count(*) from public.app_users
    union all select 'profiles',            count(*) from public.profiles
    union all select 'projects',            count(*) from public.projects
    union all select 'project_memberships', count(*) from public.project_memberships
    union all select 'work_types',          count(*) from public.work_types
    union all select 'work_assignments',    count(*) from public.work_assignments
    union all select 'performers',          count(*) from public.performers
    union all select 'plans',               count(*) from public.plans
    union all select 'reports',             count(*) from public.reports
    union all select 'report_plan_marks',   count(*) from public.report_plan_marks
    union all select 'report_photos',       count(*) from public.report_photos;
  ")

NON_EMPTY=0
while IFS='|' read -r tbl cnt; do
  [[ -z "$tbl" ]] && continue
  if [[ "$cnt" != "0" ]]; then
    NON_EMPTY=1
    echo "  $tbl: $cnt rows (non-empty)"
  fi
done <<< "$COUNTS_OUTPUT"

if [[ "$NON_EMPTY" -eq 1 ]]; then
  if [[ "${ALLOW_NON_EMPTY_TARGET:-}" == "1" ]]; then
    echo "WARNING: target has data, ALLOW_NON_EMPTY_TARGET=1 — proceeding."
    echo "         (Duplicates will rollback the import transaction.)"
  elif [[ ! -t 0 ]]; then
    echo "ERROR: target is non-empty and no tty for confirmation." >&2
    echo "       Set ALLOW_NON_EMPTY_TARGET=1 to bypass prompt (CI scenarios)," >&2
    echo "       or TRUNCATE / drop schema first for a clean import." >&2
    exit 1
  else
    read -rp "Target tables are non-empty. Continue and append? [y/N] " ans
    case "$ans" in
      y|Y) ;;
      *) echo "Aborted by user."; exit 1 ;;
    esac
  fi
else
  echo "target is empty — clean import."
fi
echo

# Импорт. Один psql --single-transaction. Любая ошибка откатывает всё.
echo "=== Importing 11 CSV in single transaction ==="

# Собираем единый SQL-скрипт с \copy для каждой таблицы.
IMPORT_SQL_TMP="$(mktemp)"
trap 'rm -f "$IMPORT_SQL_TMP"' EXIT

{
  for tbl in "${IMPORT_ORDER[@]}"; do
    cols="${COLUMNS[$tbl]}"
    csv="$EXPORT_DIR_ABS/$tbl.csv"
    printf '\\echo === importing public.%s ===\n' "$tbl"
    printf "\\copy public.%s (%s) FROM '%s' WITH (FORMAT csv, HEADER true)\n" "$tbl" "$cols" "$csv"
  done
} > "$IMPORT_SQL_TMP"

psql "$YANDEX_DB_URL" \
  --set ON_ERROR_STOP=1 \
  --single-transaction \
  --file "$IMPORT_SQL_TMP"

echo
echo "All CSV imported successfully (transaction committed)."
echo

# Post-check: validate-target.
if [[ "$SKIP_VALIDATE" -eq 1 ]]; then
  echo "WARNING: --skip-validate set, validate-target.sql NOT run" >&2
else
  echo "=== Running validate-target.sql ==="
  psql "$YANDEX_DB_URL" \
    --set ON_ERROR_STOP=1 \
    --quiet \
    --file "$SCRIPT_DIR/validate-target.sql"
  echo
fi

echo "Import complete."
