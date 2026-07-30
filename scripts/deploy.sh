#!/usr/bin/env bash
# Обновление StroyFoto на VPS `hub`: фронтенд и/или бэкенд. Запускается ПОД ROOT на самом
# сервере. К базе данных не подключается — миграции живут в отдельном скрипте
# scripts/db/apply-migrations.sh (см. db/migrations/README.md).
#
# Использование (под root на hub):
#   bash /opt/stroyfoto-api/scripts/deploy.sh [опции]
#
# Опции:
#   --front-only               только фронтенд (гейт миграций не применяется)
#   --api-only                 только бэкенд
#   --ack-migrations-applied   подтвердить, что миграции уже применены, и продолжить
#   --init-state <sha>         разовая инициализация: записать SHA развёрнутой версии
#   --no-pull                  не делать git pull (использовать код как есть)
#   --dry-run                  показать план; рабочее дерево, сервисы и БД не трогаются
#   -h, --help                 эта справка
#
# Порядок выкладки: сборка обоих компонентов → бэкенд (restart + health-check) →
# фронтенд. Сначала API, потому что новый фронт со сломанным API хуже, чем наоборот.
#
# Состояние в /var/lib/stroyfoto-deploy/last-{api,front}-sha — SHA реально развёрнутого
# компонента. Пишется только после успеха шага. Без него скрипт не работает: см.
# --init-state и раздел «Bootstrap» в docs/DEPLOYMENT.md.
#
# Что НЕ делает: не трогает nginx, apache2, чужие сервисы и общий TLS-сертификат.
# Перезапускается ровно один юнит — stroyfoto-api.

set -euo pipefail

# --- константы ---------------------------------------------------------------

APP_DIR="/opt/stroyfoto-api"
SITE_DIR="/srv/sites/stroyfoto.su10.ru"
WEB_ROOT="$SITE_DIR/public"
SERVICE="stroyfoto-api"
APP_USER="stroyfoto"
WEB_USER="www-data"
WEB_GROUP="www-data"

STATE_DIR="/var/lib/stroyfoto-deploy"
LOCK_PATH="${STROYFOTO_LOCK:-$STATE_DIR/operation.lock}"

REMOTE_NAME="origin"
EXPECTED_REMOTE_URL="https://github.com/saztonov/StroyFoto.git"
BRANCH="main"

HEALTH_BASE="http://127.0.0.1:4000/api"
HEALTH_RETRIES=10
HEALTH_INTERVAL=2

# --- параметры ---------------------------------------------------------------

ORIG_ARGS=("$@")
DO_FRONT=1
DO_API=1
ACK_MIGRATIONS=0
DO_PULL=1
DRY_RUN=0
INIT_STATE_SHA=""
FRONT_ONLY_SET=0
API_ONLY_SET=0

TS="$(date +%F_%H-%M-%S).$$"
CLEANUP_PATHS=()

die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
usage() { grep -E '^#( |$)' "$0" | sed 's/^#\{1,\} \{0,1\}//'; }

cleanup() {
  local rc=$? p
  for p in "${CLEANUP_PATHS[@]:-}"; do
    [[ -n "${p:-}" && -d "$p" ]] && rm -rf "$p"
  done
  exit "$rc"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --front-only)             DO_API=0; FRONT_ONLY_SET=1; shift ;;
    --api-only)               DO_FRONT=0; API_ONLY_SET=1; shift ;;
    --ack-migrations-applied) ACK_MIGRATIONS=1; shift ;;
    --no-pull)                DO_PULL=0; shift ;;
    --dry-run)                DRY_RUN=1; shift ;;
    --init-state)             [[ $# -ge 2 ]] || { echo "--init-state требует SHA" >&2; exit 2; }
                              INIT_STATE_SHA="$2"; shift 2 ;;
    -h|--help)                usage; exit 0 ;;
    *)                        echo "Неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done

if [[ $FRONT_ONLY_SET -eq 1 && $API_ONLY_SET -eq 1 ]]; then
  die "--front-only и --api-only взаимоисключающие"
fi

# --- хелперы -----------------------------------------------------------------

git_app() { sudo -u "$APP_USER" git -C "$APP_DIR" "$@"; }
npm_app() { sudo -u "$APP_USER" bash -lc "cd $(printf %q "$APP_DIR") && $1"; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'DRY-RUN: %s\n' "$*"
  else
    "$@"
  fi
}

state_file() { printf '%s/last-%s-sha' "$STATE_DIR" "$1"; }

# Чтение защищённое: `cat` отсутствующего файла под set -e оборвал бы скрипт молча.
read_state() {
  local comp="$1" f sha
  f="$(state_file "$comp")"
  [[ -f "$f" ]] || return 1
  sha="$(tr -d '[:space:]' < "$f")"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "повреждён $f: '$sha' не похож на SHA (см. --init-state)"
  printf '%s' "$sha"
}

# Запись атомарная: временный файл + mv.
write_state() {
  local comp="$1" sha="$2" f tmp
  f="$(state_file "$comp")"; tmp="$f.tmp.$$"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'DRY-RUN: записал бы %s = %s\n' "$f" "$sha"
    return 0
  fi
  printf '%s\n' "$sha" > "$tmp"
  mv -f "$tmp" "$f"
}

validate_state_sha() {
  local sha="$1" comp="$2"
  git_app cat-file -e "${sha}^{commit}" 2>/dev/null \
    || die "$comp: коммит $sha отсутствует в репозитории — состояние разошлось с git"
  git_app merge-base --is-ancestor "$sha" HEAD \
    || die "$comp: $sha не является предком HEAD — состояние разошлось с историей"
}

wait_health() {
  local url="$1" i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

# Диск на hub общий с соседними сайтами: staged-выкладка временно держит две копии
# каталога, и переполнение ФС ударило бы не только по нам. Проверяем заранее.
# $1 — каталог-образец (оценка размера), $2 — путь на целевой ФС.
ensure_space() {
  local sample="$1" target="$2" need avail
  [[ -d "$sample" ]] || return 0          # нечего оценивать (первая сборка) — пропускаем
  need="$(du -sk "$sample" | awk '{print $1}')"
  avail="$(df -Pk "$target" | awk 'NR==2 {print $4}')"
  if (( avail < need * 12 / 10 )); then   # запас 20%
    die "мало места на ФС каталога $target: нужно ~$((need / 1024)) МБ (+запас), свободно $((avail / 1024)) МБ"
  fi
  note "место: нужно ~$((need / 1024)) МБ, свободно $((avail / 1024)) МБ"
}

# Подмена каталога с восстановлением. Полной атомарности здесь нет: два rename() —
# два отдельных сисколла, между ними живой каталог кратковременно отсутствует.
# Настоящая атомарность потребовала бы symlink-релизов или renameat2(RENAME_EXCHANGE).
swap_dir() {
  local stage="$1" live="$2" backup="$3"
  if [[ -e "$live" ]]; then
    mv "$live" "$backup"
    if ! mv "$stage" "$live"; then
      mv "$backup" "$live"   # без этого set -e оставил бы каталог отсутствующим
      return 1
    fi
  else
    mv "$stage" "$live"
  fi
}

# --- режим --init-state ------------------------------------------------------

if [[ -n "$INIT_STATE_SHA" ]]; then
  [[ $EUID -eq 0 ]] || die "запускать под root"
  [[ -d "$APP_DIR" ]] || die "нет каталога $APP_DIR"
  [[ -d "$STATE_DIR" ]] || die "нет каталога $STATE_DIR (создать: install -d -o $APP_USER -g $APP_USER -m 0775 $STATE_DIR)"
  sha="$(git_app rev-parse --verify "${INIT_STATE_SHA}^{commit}" 2>/dev/null)" \
    || die "коммит не найден в репозитории: $INIT_STATE_SHA"

  echo "Инициализация состояния деплоя"
  echo "  SHA:      $sha"
  echo "  subject:  $(git_app log -1 --format=%s "$sha")"
  echo
  echo "Это должна быть версия, из которой СЕЙЧАС собраны И фронтенд, И бэкенд."
  echo "Если не уверены — пересоберите оба компонента из одного коммита (раздел 4"
  echo "docs/DEPLOYMENT.md) и запустите инициализацию заново."
  echo
  if [[ "${STROYFOTO_ASSUME_YES:-}" != "1" ]]; then
    [[ -t 0 ]] || die "нужен интерактивный ввод (или STROYFOTO_ASSUME_YES=1)"
    read -r -p "Подтвердить? [y/N] " answer
    [[ "$answer" == "y" || "$answer" == "Y" ]] || die "отменено"
  fi

  write_state api "$sha"
  write_state front "$sha"
  info "Состояние записано: $(state_file api), $(state_file front)"
  exit 0
fi

# --- preflight ---------------------------------------------------------------

info "Preflight"

[[ $EUID -eq 0 ]] || die "запускать под root (сборка идёт под $APP_USER, копирование в /srv — под root)"

for cmd in git npm node rsync curl systemctl sudo flock du df awk; do
  command -v "$cmd" >/dev/null 2>&1 || die "не найдена утилита: $cmd"
done

[[ -d "$APP_DIR" ]]   || die "нет каталога $APP_DIR"
[[ -d "$SITE_DIR" ]]  || die "нет каталога $SITE_DIR"
[[ -d "$STATE_DIR" ]] || die "нет каталога $STATE_DIR — bootstrap не выполнен (см. docs/DEPLOYMENT.md)"
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "нет systemd-юнита $SERVICE"

# Общий lock с мигратором: git pull не должен подменить .sql во время миграции,
# а рестарт API — случиться посреди DDL.
# При re-exec fd 9 унаследован от родителя; повторный `exec 9>` закрыл бы его
# и на мгновение снял блокировку.
if [[ -z "${STROYFOTO_DEPLOY_REEXEC:-}" ]]; then
  [[ -e "$LOCK_PATH" ]] || die "нет lock-файла $LOCK_PATH — bootstrap не выполнен"
  exec 9>>"$LOCK_PATH"
  flock -n 9 || die "уже выполняется деплой или миграция (lock: $LOCK_PATH)"
fi

# Все git-команды — под $APP_USER: репозиторий принадлежит ему, git под root
# ругается «dubious ownership».
actual_remote="$(git_app remote get-url "$REMOTE_NAME")"
[[ "$actual_remote" == "$EXPECTED_REMOTE_URL" ]] \
  || die "remote $REMOTE_NAME = $actual_remote, ожидался $EXPECTED_REMOTE_URL"

actual_branch="$(git_app rev-parse --abbrev-ref HEAD)"
[[ "$actual_branch" != "HEAD" ]] \
  || die "репозиторий в detached HEAD — вернуть: sudo -u $APP_USER git -C $APP_DIR checkout $BRANCH"
[[ "$actual_branch" == "$BRANCH" ]] \
  || die "текущая ветка $actual_branch, ожидалась $BRANCH"

if [[ -n "$(git_app status --porcelain)" ]]; then
  git_app status --short >&2
  die "рабочее дерево не чисто — деплой собрал бы случайные локальные правки"
fi

note "remote: $actual_remote"
note "ветка:  $actual_branch"
note "цели:   $([[ $DO_API -eq 1 ]] && printf 'api ')$([[ $DO_FRONT -eq 1 ]] && printf 'front')"

# --- pull --------------------------------------------------------------------

sha_before="$(git_app rev-parse HEAD)"

if [[ $DO_PULL -eq 1 ]]; then
  info "Обновление кода"
  if [[ $DRY_RUN -eq 1 ]]; then
    # fetch пишет в .git, но не двигает рабочее дерево — нужен, чтобы показать,
    # что именно приедет (включая новые миграции).
    git_app fetch "$REMOTE_NAME" "$BRANCH"
    target="$(git_app rev-parse "$REMOTE_NAME/$BRANCH")"
    note "$sha_before → $target"
    git_app log --oneline "$sha_before..$target" || true
  else
    git_app pull --ff-only "$REMOTE_NAME" "$BRANCH"
  fi
fi

sha_head="$(git_app rev-parse HEAD)"
if [[ $DRY_RUN -eq 1 && $DO_PULL -eq 1 ]]; then
  # В dry-run HEAD не двигали — сравниваем с тем, что приехало бы.
  sha_head="$(git_app rev-parse "$REMOTE_NAME/$BRANCH")"
fi

if [[ "$sha_before" != "$sha_head" ]]; then
  note "$sha_before → $sha_head"
  git_app log --oneline "$sha_before..$sha_head" | sed 's/^/    /' || true
else
  note "новых коммитов нет ($sha_head)"
fi

# --- re-exec, если обновился сам скрипт --------------------------------------
# Запущенный bash дочитывает файл по ходу выполнения, поэтому после pull текущий
# процесс продолжил бы работать по старой версии.

if [[ $DRY_RUN -eq 0 && $DO_PULL -eq 1 && "$sha_before" != "$sha_head" ]]; then
  if [[ -n "$(git_app diff --name-only "$sha_before..$sha_head" -- scripts/deploy.sh)" ]]; then
    [[ -z "${STROYFOTO_DEPLOY_REEXEC:-}" ]] \
      || die "повторный re-exec — прерываю (скрипт меняется в цикле?)"
    info "scripts/deploy.sh обновился — перезапускаюсь в новой версии"
    # flock на fd 9 переживает exec, гонка не открывается.
    export STROYFOTO_DEPLOY_REEXEC=1
    exec bash "$APP_DIR/scripts/deploy.sh" "${ORIG_ARGS[@]}" --no-pull
  fi
fi

# --- состояние ---------------------------------------------------------------

last_api=""
last_front=""

if [[ $DO_API -eq 1 ]]; then
  last_api="$(read_state api)" || die "нет $(state_file api) — bootstrap не выполнен, см. --init-state"
  validate_state_sha "$last_api" "api"
fi
if [[ $DO_FRONT -eq 1 ]]; then
  last_front="$(read_state front)" || die "нет $(state_file front) — bootstrap не выполнен, см. --init-state"
  validate_state_sha "$last_front" "front"
fi

# --- гейт миграций -----------------------------------------------------------
# Сравниваем от SHA реально развёрнутого API, а не от SHA до pull: иначе после
# остановки на миграциях они выпадут из диапазона и гейт «забудет» о них.

if [[ $DO_API -eq 1 && $ACK_MIGRATIONS -eq 0 ]]; then
  # Только *.sql: под db/migrations/ лежат ещё README.md и прочая документация,
  # изменения которой не повод останавливать деплой.
  pending_migrations="$(git_app diff --name-only "$last_api..$sha_head" -- 'db/migrations/*.sql' || true)"
  if [[ -n "$pending_migrations" ]]; then
    echo
    echo "В этом обновлении есть изменения миграций:"
    while IFS= read -r m; do
      [[ -n "$m" ]] && echo "  $m"
    done <<< "$pending_migrations"
    cat <<EOF

Схему нужно обновить ДО выкладки нового бэкенда. Порядок:

  sudo -u $APP_USER bash -lc 'cd $APP_DIR && bash scripts/db/apply-migrations.sh --env-file server/.env --status'
  sudo -u $APP_USER bash -lc 'cd $APP_DIR && bash scripts/db/apply-migrations.sh --env-file server/.env'
  bash $APP_DIR/scripts/deploy.sh --ack-migrations-applied

Разрушающие изменения (drop/rename колонки) требуют expand/contract —
см. db/migrations/README.md.
EOF
    exit 1
  fi
fi

# --- нужно ли что-то делать --------------------------------------------------

need_api=0
need_front=0
[[ $DO_API -eq 1   && "$last_api"   != "$sha_head" ]] && need_api=1
[[ $DO_FRONT -eq 1 && "$last_front" != "$sha_head" ]] && need_front=1

if [[ $need_api -eq 0 && $need_front -eq 0 ]]; then
  info "Развёрнутая версия совпадает с $sha_head — делать нечего."
  exit 0
fi

[[ $DO_API -eq 1 ]]   && note "api:   ${last_api:0:12} → ${sha_head:0:12} $([[ $need_api -eq 1 ]] && echo '(обновляем)' || echo '(актуален)')"
[[ $DO_FRONT -eq 1 ]] && note "front: ${last_front:0:12} → ${sha_head:0:12} $([[ $need_front -eq 1 ]] && echo '(обновляем)' || echo '(актуален)')"

# --- зависимости -------------------------------------------------------------

info "Зависимости (npm ci)"
# npm ci пересобирает живой node_modules под работающим сервисом. Fastify грузит
# модули на старте, поэтому практически безопасно; полная изоляция (release-каталоги
# со своим node_modules) — отдельный этап.
run npm_app "npm ci"

# --- сборка (обоих компонентов до любой выкладки) ----------------------------

api_stage="$APP_DIR/server/dist.new.$TS"
front_stage="$SITE_DIR/public.new.$TS"

if [[ $need_api -eq 1 ]]; then
  info "Сборка бэкенда → server/dist.new.$TS"
  ensure_space "$APP_DIR/server/dist" "$APP_DIR"
  CLEANUP_PATHS+=("$api_stage")
  # Собираем в сторону, а не в живой server/dist.
  # --tsBuildInfoFile обязателен: при composite (⇒ incremental) tsc сверился бы со
  # старым .tsbuildinfo, счёл вывод актуальным и не сгенерировал бы НИЧЕГО в пустой
  # каталог.
  run npm_app "npm exec -- tsc -p server/tsconfig.json \
      --outDir $(printf %q "$api_stage") \
      --tsBuildInfoFile $(printf %q "$api_stage/.tsbuildinfo")"
  if [[ $DRY_RUN -eq 0 ]]; then
    [[ -f "$api_stage/server.js" ]] || die "сборка бэкенда не дала server.js"
  fi
fi

if [[ $need_front -eq 1 ]]; then
  info "Сборка фронтенда"
  # Именно build:front, а не build: обычный `npm run build` через корневые
  # references собирает и server/, перезаписывая живой server/dist.
  run npm_app "npm run build:front"
  if [[ $DRY_RUN -eq 0 ]]; then
    [[ -f "$APP_DIR/dist/index.html" ]] || die "сборка фронтенда не дала dist/index.html"
  fi
fi

# --- выкладка: сначала API ---------------------------------------------------

if [[ $need_api -eq 1 ]]; then
  info "Выкладка бэкенда"
  api_live="$APP_DIR/server/dist"
  api_backup="$APP_DIR/server/dist.bak.$TS"

  if [[ $DRY_RUN -eq 1 ]]; then
    note "DRY-RUN: swap $api_stage → $api_live (бэкап $api_backup)"
    note "DRY-RUN: systemctl restart $SERVICE"
    note "DRY-RUN: health-check $HEALTH_BASE/health, $HEALTH_BASE/db-health"
  else
    swap_dir "$api_stage" "$api_live" "$api_backup" || die "не удалось подменить server/dist"
    chown -R "$APP_USER:$APP_USER" "$api_live"

    info "Перезапуск $SERVICE"
    systemctl restart "$SERVICE"

    if ! wait_health "$HEALTH_BASE/health"; then
      echo >&2
      echo "journalctl -u $SERVICE -n 50 --no-pager:" >&2
      journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
      cat >&2 <<EOF

Бэкенд не отвечает на $HEALTH_BASE/health.
Откат:
  rm -rf $api_live && mv $api_backup $api_live
  systemctl restart $SERVICE
  printf '%s\n' "$last_api" > $(state_file api)
EOF
      die "health-check не прошёл"
    fi
    if ! wait_health "$HEALTH_BASE/db-health"; then
      die "/api/db-health не отвечает — проверьте DATABASE_URL/PGSSLROOTCERT и доступность Yandex MDB"
    fi

    note "health OK"
    write_state api "$sha_head"
    note "бэкап предыдущей сборки: $api_backup"
  fi
fi

# --- выкладка: потом фронт ---------------------------------------------------

if [[ $need_front -eq 1 ]]; then
  info "Выкладка фронтенда"
  front_backup="$SITE_DIR/public.bak.$TS"

  if [[ $DRY_RUN -eq 1 ]]; then
    note "DRY-RUN: rsync $APP_DIR/dist/ → $front_stage/"
    note "DRY-RUN: swap $front_stage → $WEB_ROOT (бэкап $front_backup)"
  else
    ensure_space "$APP_DIR/dist" "$SITE_DIR"
    CLEANUP_PATHS+=("$front_stage")
    rsync -a "$APP_DIR/dist/" "$front_stage/"
    [[ -f "$front_stage/index.html" ]] || die "в собранном фронте нет index.html"
    [[ -d "$front_stage/assets" ]]     || die "в собранном фронте нет каталога assets"
    chown -R "$WEB_USER:$WEB_GROUP" "$front_stage"

    swap_dir "$front_stage" "$WEB_ROOT" "$front_backup" \
      || die "не удалось подменить каталог фронта — предыдущая версия возвращена на место"

    write_state front "$sha_head"
    note "бэкап предыдущей версии: $front_backup"
    # nginx перезагружать не нужно — это статика.
  fi
fi

# --- итог --------------------------------------------------------------------

echo
info "Готово"
note "версия:  ${sha_head}"
[[ $need_api -eq 1 ]]   && note "бэкенд:  обновлён, $SERVICE перезапущен"
[[ $need_front -eq 1 ]] && note "фронт:   обновлён"

if [[ $DRY_RUN -eq 0 ]]; then
  echo
  echo "Откат (вернуть И каталог, И файл состояния — иначе следующий запуск решит,"
  echo "что новая версия уже развёрнута):"
  if [[ $need_api -eq 1 ]]; then
    echo "  бэкенд:"
    echo "    rm -rf $APP_DIR/server/dist && mv $APP_DIR/server/dist.bak.$TS $APP_DIR/server/dist"
    echo "    systemctl restart $SERVICE"
    printf "    printf '%%s\\\\n' %s > %s\n" "$last_api" "$(state_file api)"
  fi
  if [[ $need_front -eq 1 ]]; then
    echo "  фронт:"
    echo "    rm -rf $WEB_ROOT && mv $SITE_DIR/public.bak.$TS $WEB_ROOT"
    printf "    printf '%%s\\\\n' %s > %s\n" "$last_front" "$(state_file front)"
  fi
  echo
  echo "Откат самого кода — git revert нужного коммита и обычный деплой."
  echo "Команду 'git checkout <sha>' не используем: она оставляет detached HEAD"
  echo "и ломает следующий git pull --ff-only."
fi

exit 0
