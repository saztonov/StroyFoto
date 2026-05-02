#!/usr/bin/env bash
# export-from-supabase.sh
# Экспорт application-данных из Supabase.com в CSV.
#
# Использование:
#   SUPABASE_DB_URL="postgres://postgres:...@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
#     bash scripts/migrate-db/export-from-supabase.sh [<export-dir>]
#
# Опции:
#   --skip-validate    не запускать validate-source.sql (не рекомендуется)
#   -h, --help         помощь
#
# Env:
#   SUPABASE_DB_URL    обязательно — connection string источника
#   EXPORT_DIR         альтернатива позиционному <export-dir>
#
# Поведение:
#   * Если export-dir не задан — создаётся scripts/migrate-db/exports/<UTC-timestamp>/.
#   * Если в директории уже есть *.csv — exit 1 (no silent overwrite).
#   * Запускает validate-source.sql (RAISE EXCEPTION на schema-mismatch).
#   * Использует client-side \copy (server-side COPY требует superuser).
#   * Выходит с абсолютным путём export-dir на stdout последней строкой.

set -euo pipefail

SKIP_VALIDATE=0
ARG_EXPORT_DIR=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set" >&2
  echo "Usage: SUPABASE_DB_URL=postgres://... bash $0 [<export-dir>]" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql is not installed or not in PATH" >&2
  exit 1
fi

# Определяем export-dir: позиционный arg → env EXPORT_DIR → автогенерация.
if [[ -n "$ARG_EXPORT_DIR" ]]; then
  EXPORT_DIR="$ARG_EXPORT_DIR"
elif [[ -n "${EXPORT_DIR:-}" ]]; then
  : # уже задана
else
  EXPORT_DIR="$SCRIPT_DIR/exports/$(date -u +%Y%m%dT%H%M%SZ)"
fi

mkdir -p "$EXPORT_DIR"

# Защита от silent overwrite: если в директории уже есть CSV — стоп.
if compgen -G "$EXPORT_DIR/*.csv" > /dev/null; then
  echo "ERROR: directory already contains CSV files: $EXPORT_DIR" >&2
  echo "       Choose another directory or remove existing files manually." >&2
  exit 1
fi

# Безопасный путь и маскирование пароля в логе.
EXPORT_DIR_ABS="$(cd "$EXPORT_DIR" && pwd)"
SAFE_URL="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's#://([^:]+):[^@]+@#://\1:****@#')"
echo "Source : $SAFE_URL"
echo "Output : $EXPORT_DIR_ABS"
echo

# Шаг 1. validate-source.
if [[ "$SKIP_VALIDATE" -eq 1 ]]; then
  echo "WARNING: --skip-validate set, schema preconditions are not checked" >&2
else
  echo "=== Running validate-source.sql ==="
  psql "$SUPABASE_DB_URL" \
    --set ON_ERROR_STOP=1 \
    --quiet \
    --file "$SCRIPT_DIR/validate-source.sql"
  echo
fi

# Шаг 2. Экспорт CSV. Каждый запрос читается из stdin как heredoc с
# quoted-delimiter ('SQL'), что отключает любую bash-интерполяцию ($, `,
# \) внутри SQL — это критично для regex с литеральным $ (bcrypt).
run_copy() {
  local file="$1"
  local query
  query=$(cat)
  echo "=== Exporting $(basename "$file") ==="
  # \copy требует, чтобы запрос был на одной строке.
  local one_line
  one_line=$(printf '%s' "$query" | tr '\n' ' ')
  psql "$SUPABASE_DB_URL" \
    --set ON_ERROR_STOP=1 \
    --quiet \
    -c "\\copy ($one_line) TO '$file' WITH (FORMAT csv, HEADER true)"
  local total
  total=$(wc -l < "$file" | tr -d ' ')
  local rows=$(( total > 0 ? total - 1 : 0 ))
  echo "    OK: $rows rows → $file"
}

# app_users: bcrypt-prefix фильтрация в SQL. Регэксп '^\$2[aby]\$'
# должен попасть в SQL как есть — поэтому heredoc с 'SQL' (quoted).
run_copy "$EXPORT_DIR_ABS/app_users.csv" <<'SQL'
select
  u.id,
  lower(u.email) as email,
  case
    when u.encrypted_password ~ '^\$2[aby]\$' then u.encrypted_password
    else null
  end as password_hash,
  (u.encrypted_password is null
   or u.encrypted_password !~ '^\$2[aby]\$') as password_must_reset,
  coalesce(u.created_at, now()) as created_at,
  coalesce(u.updated_at, now()) as updated_at
from auth.users u
join public.profiles p on p.id = u.id
where u.deleted_at is null
order by u.created_at
SQL

run_copy "$EXPORT_DIR_ABS/profiles.csv" <<'SQL'
select id, full_name, role, is_active, created_at, updated_at
from public.profiles
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/projects.csv" <<'SQL'
select id, name, description, created_by, created_at, updated_at
from public.projects
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/project_memberships.csv" <<'SQL'
select project_id, user_id, created_at
from public.project_memberships
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/work_types.csv" <<'SQL'
select id, name, is_active, created_by, created_at
from public.work_types
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/work_assignments.csv" <<'SQL'
select id, name, is_active, created_by, created_at
from public.work_assignments
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/performers.csv" <<'SQL'
select id, name, kind, is_active, created_at
from public.performers
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/plans.csv" <<'SQL'
select id, project_id, name, r2_key, page_count, uploaded_by, created_at,
       floor, building, section, updated_at, storage
from public.plans
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/reports.csv" <<'SQL'
select id, project_id, work_type_id, performer_id, plan_id, author_id,
       description, taken_at, created_at, updated_at, work_assignment_id
from public.reports
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/report_plan_marks.csv" <<'SQL'
select id, report_id, plan_id, page, x_norm, y_norm, created_at
from public.report_plan_marks
order by created_at
SQL

run_copy "$EXPORT_DIR_ABS/report_photos.csv" <<'SQL'
select id, report_id, r2_key, thumb_r2_key, width, height,
       taken_at, created_at, storage
from public.report_photos
order by created_at
SQL

echo
echo "All CSV exported successfully."
echo
echo "Run import:"
echo "  YANDEX_DB_URL='postgres://...' bash scripts/migrate-db/import-to-yandex.sh $EXPORT_DIR_ABS"
echo

# Последняя строка stdout — абсолютный путь, чтобы `EXPORT=$(./export... | tail -1)` работал.
echo "$EXPORT_DIR_ABS"
