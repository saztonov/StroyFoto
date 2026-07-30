#!/usr/bin/env bash
# Применяет db/migrations/*.sql к DATABASE_URL по алфавиту имени — каждую ровно один раз.
#
# Учёт применённого ведётся в таблице public.schema_migrations (filename, checksum,
# applied_at). Миграция и запись в журнал выполняются в ОДНОЙ транзакции, поэтому
# «применилось, но не записалось» невозможно.
#
# Использование:
#   DATABASE_URL="postgres://user:pass@host:6432/db?sslmode=verify-full" \
#     bash scripts/db/apply-migrations.sh
#   bash scripts/db/apply-migrations.sh --env-file server/.env
#
# Опции:
#   --dir <path>            директория с миграциями (по умолчанию db/migrations)
#   --env-file <path>       взять DATABASE_URL и PGSSLROOTCERT из .env-файла
#   --status                показать applied/pending и выйти; БД не изменяется
#   --dry-run               показать, что было бы применено; БД не изменяется
#   --mark-applied <файл>   записать миграцию в журнал БЕЗ выполнения
#   -h, --help              эта справка
#
# Коды возврата:
#   0  всё хорошо (в т.ч. когда есть pending при --status)
#   1  ошибка выполнения
#   2  неверные аргументы
#   3  нарушена целостность истории (checksum mismatch / файл пропал)
#
# ВАЖНО:
#   * миграции неизменяемы — правка применённого файла ломает checksum; нужен новый файл;
#   * файл не должен содержать BEGIN/COMMIT — транзакцией управляет psql;
#   * нетранзакционные DDL (CREATE INDEX CONCURRENTLY) здесь выполнить нельзя:
#     применить вручную через psql, проверить результат, затем --mark-applied.
#
# Параллельный запуск: на одном сервере отсекается файловым flock, между машинами —
# транзакционным advisory lock. Двойного применения не происходит, но второй процесс
# завершится ОШИБКОЙ с полным откатом (он уже прошёл проверку журнала до того, как
# первый закоммитил). Это штатное безопасное поведение — просто перезапустите его.

set -euo pipefail

MIGRATIONS_DIR="db/migrations"
ENV_FILE=""
MODE="apply"          # apply | status | dry-run | mark-applied
MARK_TARGET=""
LEDGER="public.schema_migrations"
# Ключ advisory-блокировки: защищает от параллельного применения даже с другой машины,
# где файловый flock бесполезен. Транзакционный — снимается сам при commit/rollback.
ADVISORY_KEY="${STROYFOTO_MIGRATE_ADVISORY_KEY:-4242424242}"
LOCK_PATH="${STROYFOTO_LOCK:-/var/lib/stroyfoto-deploy/operation.lock}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

usage() { grep -E '^#( |$)' "$0" | sed 's/^#\{1,\} \{0,1\}//'; }

# --- аргументы ---------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)          [[ $# -ge 2 ]] || { echo "--dir требует значение" >&2; exit 2; }
                    MIGRATIONS_DIR="$2"; shift 2 ;;
    --env-file)     [[ $# -ge 2 ]] || { echo "--env-file требует значение" >&2; exit 2; }
                    ENV_FILE="$2"; shift 2 ;;
    --status)       MODE="status"; shift ;;
    --dry-run)      MODE="dry-run"; shift ;;
    --mark-applied) [[ $# -ge 2 ]] || { echo "--mark-applied требует имя файла" >&2; exit 2; }
                    MODE="mark-applied"; MARK_TARGET="$2"; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *)              echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done

# --- .env: разбор по правилам dotenv, а НЕ через source ----------------------
# source выполнил бы произвольный код из файла и исказил бы значения со спецсимволами.

load_env_file() {
  local path="$1" line key val
  [[ -f "$path" ]] || die "env-file не найден: $path"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"                                  # CRLF
    line="${line#"${line%%[![:space:]]*}"}"               # ltrim
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"; val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"                  # rtrim ключа
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$key" in
      DATABASE_URL|PGSSLROOTCERT) ;;
      *) continue ;;
    esac
    # снять парные кавычки, если значение целиком в них
    if [[ ${#val} -ge 2 && "$val" == \"*\" ]]; then val="${val:1:${#val}-2}"
    elif [[ ${#val} -ge 2 && "$val" == \'*\' ]]; then val="${val:1:${#val}-2}"
    fi
    export "$key=$val"
  done < "$path"
}

[[ -n "$ENV_FILE" ]] && load_env_file "$ENV_FILE"

# --- предусловия -------------------------------------------------------------

[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL не задан (или укажите --env-file)"
command -v psql >/dev/null 2>&1 || die "psql не установлен или не в PATH"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum не найден"
[[ -d "$MIGRATIONS_DIR" ]] || die "каталог миграций не найден: $MIGRATIONS_DIR"

SAFE_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#://([^:]+):[^@]+@#://\1:****@#')"

# --- блокировка (только для изменяющих режимов) ------------------------------
# Общий файл с scripts/deploy.sh: git pull не должен подменить .sql во время миграции,
# а рестарт API — случиться посреди DDL.

acquire_lock() {
  local dir; dir="$(dirname "$LOCK_PATH")"
  if [[ -d "$dir" ]] && { [[ -w "$LOCK_PATH" ]] || { [[ ! -e "$LOCK_PATH" ]] && [[ -w "$dir" ]]; }; }; then
    exec 9>>"$LOCK_PATH"
    if command -v flock >/dev/null 2>&1; then
      flock -n 9 || die "уже выполняется деплой или миграция (lock: $LOCK_PATH)"
    else
      warn "flock не найден — продолжаю без блокировки"
    fi
  else
    warn "lock недоступен ($LOCK_PATH) — продолжаю без него (ожидаемо вне прод-сервера)"
  fi
}

# --- работа с журналом -------------------------------------------------------

psql_scalar() {
  psql "$DATABASE_URL" -X -q -A -t --set ON_ERROR_STOP=1 -c "$1"
}

ledger_exists() {
  local r; r="$(psql_scalar "select to_regclass('$LEDGER') is not null")"
  [[ "$r" == "t" ]]
}

ensure_ledger() {
  psql "$DATABASE_URL" -X -q --set ON_ERROR_STOP=1 -c "
    set client_min_messages = warning;
    create table if not exists $LEDGER (
      filename   text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )" >/dev/null
}

# psql НЕ подставляет переменные (:'fn') в аргументах -c — литерал ушёл бы на сервер.
# Интерполяция работает только в файлах, читаемых через -f, поэтому insert живёт
# во временном файле: так квотированием по-прежнему занимается psql, а не мы.
INSERT_SQL=""
insert_sql_file() {
  if [[ -z "$INSERT_SQL" ]]; then
    INSERT_SQL="$(mktemp)"
    printf "insert into %s(filename, checksum) values (:'fn', :'sum');\n" "$LEDGER" > "$INSERT_SQL"
  fi
  printf '%s' "$INSERT_SQL"
}
cleanup_tmp() { [[ -n "$INSERT_SQL" && -f "$INSERT_SQL" ]] && rm -f "$INSERT_SQL"; return 0; }
trap cleanup_tmp EXIT

# Транзакционный advisory lock: сериализует применение даже при запуске с другой
# машины, где файловый flock бесполезен. DO-блок вместо select — чтобы не печатать
# результат. Снимается сам при commit/rollback.
LOCK_SQL="do \$\$ begin perform pg_advisory_xact_lock($ADVISORY_KEY); end \$\$"

checksum_of() { sha256sum "$1" | awk '{print $1}'; }

# --- сбор состояния ----------------------------------------------------------

mapfile -t MIGRATIONS < <(LC_ALL=C find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)

declare -A APPLIED=()
LEDGER_READY=0
if ledger_exists; then
  LEDGER_READY=1
  while IFS=$'\t' read -r fn sum; do
    [[ -n "${fn:-}" ]] && APPLIED["$fn"]="$sum"
  done < <(psql "$DATABASE_URL" -X -q -A -t -F $'\t' --set ON_ERROR_STOP=1 \
             -c "select filename, checksum from $LEDGER order by filename")
fi

PENDING=()
PROBLEMS=()

for f in "${MIGRATIONS[@]:-}"; do
  [[ -n "$f" ]] || continue
  base="$(basename "$f")"
  if [[ -n "${APPLIED[$base]:-}" ]]; then
    if [[ "$(checksum_of "$f")" != "${APPLIED[$base]}" ]]; then
      PROBLEMS+=("$base: изменён после применения (checksum не совпадает с журналом)")
    fi
  else
    PENDING+=("$f")
  fi
done

# запись в журнале есть, а файла на диске нет — обычно «выкачен не тот коммит»
for base in "${!APPLIED[@]}"; do
  [[ -f "$MIGRATIONS_DIR/$base" ]] || \
    PROBLEMS+=("$base: есть в журнале, но файла нет в $MIGRATIONS_DIR")
done

report() {
  echo "База: $SAFE_URL"
  echo "Каталог: $MIGRATIONS_DIR"
  if [[ "$LEDGER_READY" -eq 1 ]]; then
    echo "Применено: ${#APPLIED[@]}"
  else
    echo "Применено: журнал ещё не создан ($LEDGER отсутствует)"
  fi
  echo "Ожидают применения: ${#PENDING[@]}"
  local f
  for f in "${PENDING[@]:-}"; do [[ -n "$f" ]] && echo "  + $(basename "$f")"; done
  if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
    echo
    echo "ПРОБЛЕМЫ ЦЕЛОСТНОСТИ (${#PROBLEMS[@]}):"
    for f in "${PROBLEMS[@]}"; do echo "  ! $f"; done
  fi
}

# --- режимы ------------------------------------------------------------------

case "$MODE" in
  status|dry-run)
    # Никаких изменений в БД: журнал не создаём, только читаем.
    report
    [[ ${#PROBLEMS[@]} -gt 0 ]] && exit 3
    [[ "$MODE" == "dry-run" ]] && echo && echo "DRY-RUN: ничего не применяем."
    exit 0
    ;;

  mark-applied)
    base="$(basename "$MARK_TARGET")"
    target="$MIGRATIONS_DIR/$base"
    [[ -f "$target" ]] || die "файл не найден: $target (--mark-applied принимает только существующий файл)"
    acquire_lock
    ensure_ledger
    if [[ -n "${APPLIED[$base]:-}" ]]; then
      die "$base уже есть в журнале — перезапись запрещена"
    fi
    sum="$(checksum_of "$target")"
    if ! psql "$DATABASE_URL" -X -q --set ON_ERROR_STOP=1 --single-transaction \
           -v fn="$base" -v sum="$sum" \
           -c "$LOCK_SQL" \
           -f "$(insert_sql_file)" >/dev/null; then
      die "не удалось записать $base в журнал"
    fi
    echo "Отмечено применённым БЕЗ выполнения: $base"
    echo "checksum: $sum"
    exit 0
    ;;

  apply)
    if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
      report
      echo >&2
      die "нарушена целостность истории миграций — применение остановлено"
    fi
    if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
      echo "В $MIGRATIONS_DIR нет .sql — применять нечего."
      exit 0
    fi
    if [[ ${#PENDING[@]} -eq 0 ]]; then
      echo "Все миграции уже применены (${#APPLIED[@]} в журнале) — нечего делать."
      exit 0
    fi

    acquire_lock
    ensure_ledger
    report
    echo

    for f in "${PENDING[@]}"; do
      base="$(basename "$f")"
      sum="$(checksum_of "$f")"
      echo "=== Применяю $base ==="
      # Миграция + запись в журнал в одной транзакции: «применилось, но не
      # записалось» невозможно. Имя файла и checksum передаются psql-переменными
      # (:'fn' в insert-файле), а не склейкой SQL.
      # psql с ON_ERROR_STOP возвращает 3 — перехватываем, чтобы код 3 остался
      # закреплён за нарушением целостности истории.
      if ! psql "$DATABASE_URL" -X -q --set ON_ERROR_STOP=1 --single-transaction \
             -v fn="$base" -v sum="$sum" \
             -c "$LOCK_SQL" \
             -f "$f" \
             -f "$(insert_sql_file)"; then
        die "миграция $base не применилась — транзакция откачена, журнал не изменён"
      fi
      echo "    OK: $base"
      echo
    done

    echo "Готово: применено ${#PENDING[@]} миграц."
    exit 0
    ;;
esac
