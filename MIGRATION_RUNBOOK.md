# StroyFoto — Runbook миграции Supabase → Yandex MDB + Cloud.ru

Дата: 2026-05-02. Этот файл — пошаговая инструкция для выполнения миграции
на staging и затем на production. Все команды можно копировать как есть.

> Параллельно с этим файлом полезны:
> - [MIGRATION_AUDIT.md](MIGRATION_AUDIT.md) — аудит того, что переносим и почему
> - [scripts/migrate-db/README.md](scripts/migrate-db/README.md) — детали SQL-импорта
> - [CLAUDE.md](CLAUDE.md) — общая архитектура проекта

---

## 0. Что должно быть готово до старта

### 0.1 Инструменты на машине, с которой выполняется миграция

| Инструмент | Назначение | Как поставить |
|---|---|---|
| `node` ≥ 20.16 | сборка фронта/бэка, выполнение скриптов | `nvm install 20` |
| `npm` (идёт с node) | пакетный менеджер | — |
| `psql` ≥ 14 | экспорт из Supabase + импорт в Yandex | Win: «PostgreSQL command line tools» от EnterpriseDB; macOS: `brew install libpq && brew link --force libpq`; Linux: `apt-get install postgresql-client` |
| `bash` ≥ 4 | shell-скрипты `scripts/migrate-db/*.sh` и `scripts/db/apply-migrations.sh` | Win: Git Bash или WSL |
| `curl` + `jq` (опц) | smoke по API через CLI | `apt/brew install curl jq` |
| `openssl` | генерация JWT_SECRET | обычно уже есть |

Проверка:
```bash
node --version
npm --version
psql --version
bash --version
```

### 0.2 Доступы и URL'ы

Должны быть на руках:

- **`SUPABASE_DB_URL`** — connection string источника, формата
  `postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require`.
  Лежит в Supabase Dashboard → Project Settings → Database → Connection string.
  Используется только для экспорта данных в CSV.
- **`YANDEX_DB_URL`** — connection string цели, формата
  `postgres://<user>:<password>@rc1<id>.mdb.yandexcloud.net:6432/<db>?sslmode=verify-full`.
  Пользователь должен иметь права CREATE TABLE / OWNER на схеме `public`
  (для применения миграций) и INSERT на все таблицы (для импорта CSV).
- **Cloud.ru S3 ключи**: `CLOUDRU_TENANT_ID`, `CLOUDRU_KEY_ID`,
  `CLOUDRU_KEY_SECRET`, `CLOUDRU_BUCKET`. Без них презайн фото/планов
  на проде не заработает.
- **(опционально) Cloudflare R2 ключи**: `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` — нужны только
  если в БД ещё есть строки `storage='r2'` и нужно мигрировать
  историческое содержимое R2 в Cloud.ru. Если БД с нуля и в R2 ничего
  не лежит — пропускайте.
- **JWT_ACCESS_SECRET** — длинная случайная строка ≥ 32 символа. Сгенерируйте:
  ```bash
  openssl rand -hex 32
  ```

### 0.3 `server/.env` для production-инстанса

```bash
cp server/.env.example server/.env
```

Заполните:

```env
DATABASE_URL=postgres://...:6432/<db>?sslmode=verify-full
JWT_ACCESS_SECRET=<вывод openssl rand -hex 32>

ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=30d

# Список разрешённых origin'ов через запятую (фронт + локальная dev-машина):
CORS_ORIGINS=https://stroyfoto.example,https://www.stroyfoto.example

PORT=4000
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info

CLOUDRU_TENANT_ID=...
CLOUDRU_KEY_ID=...
CLOUDRU_KEY_SECRET=...
CLOUDRU_BUCKET=stroyfoto-prod
CLOUDRU_ENDPOINT=https://s3.cloud.ru
CLOUDRU_REGION=ru-central-1

# R2 — только если нужна миграция объектов
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

Файл `server/.env` НЕ КОММИТИТСЯ (он в `.gitignore`).

### 0.4 `.env.production` для фронта

В корне проекта:

```env
VITE_API_URL=/api
```

(Если фронт и бэк на одном домене и `/api/*` проксируется на Fastify
через nginx/Caddy — этого достаточно. Иначе укажите абсолютный URL
бэкенда.)

---

## 1. Подготовка кодовой базы

```bash
git pull
npm install
npm run typecheck       # tsc -b --noEmit (фронт + бэк)
npm run build           # tsc -b && vite build → dist/
npm run server:build    # tsc -p server/tsconfig.json → server/dist/
```

Все 3 команды должны пройти без ошибок. Если что-то падает — фиксить
и не идти дальше.

> Подсказка: после `vite build` PWA service worker (`dist/sw.js`)
> кэширует `s3.cloud.ru` и `*.r2.cloudflarestorage.com` — это нужно
> для офлайн-режима и не зависит от хоста, на котором раздаётся фронт.

---

## 2. Применить схему на пустую Yandex БД

```bash
export DATABASE_URL="postgres://...:6432/<db>?sslmode=verify-full"

npm run migrate:db
# эквивалент: bash scripts/db/apply-migrations.sh
```

Что произойдёт:

1. Скрипт найдёт все `db/migrations/*.sql` в алфавитном порядке.
2. Применит каждый файл в `--single-transaction`. Любая ошибка → ROLLBACK.
3. На текущий момент применятся:
   - `001_init.sql` — все таблицы, enum'ы (`user_role`, `performer_kind`),
     citext-индексы, триггер `set_updated_at`.
   - `002_auth_refresh_tokens.sql` — refresh-токены с rotation chain.

Проверка результата:

```bash
psql "$DATABASE_URL" -c "\dt public.*"
# Ожидаем 12 таблиц: app_users, profiles, projects, project_memberships,
# work_types, work_assignments, performers, plans, reports,
# report_plan_marks, report_photos, refresh_tokens.
```

Опции скрипта (если нужно):
```bash
bash scripts/db/apply-migrations.sh --dry-run     # только список миграций
bash scripts/db/apply-migrations.sh --dir db/migrations
```

---

## 3. (Только при cutover с Supabase) Экспорт данных в CSV

Если вы переносите существующих пользователей и проекты — выполняем
этот шаг. Если разворачиваете новую инсталляцию — пропускайте,
переходите к шагу 5 (bootstrap admin'а).

```bash
export SUPABASE_DB_URL="postgres://postgres:...@db.<ref>.supabase.co:5432/postgres?sslmode=require"

EXPORT_DIR=$(bash scripts/migrate-db/export-from-supabase.sh | tail -1)
echo "Экспорт лежит здесь: $EXPORT_DIR"
ls -la "$EXPORT_DIR"
```

Должно появиться 11 CSV-файлов:

```
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
```

Что внутри происходит:

1. `validate-source.sql` проверяет схему Supabase (RAISE EXCEPTION
   при несоответствии).
2. `\copy` 11 таблиц с маппингом `auth.users → app_users`.
3. **Пароли**: bcrypt-хэши формата `$2a$..$2b$..$2y$..` сохраняются как
   есть; всё остальное → `password_hash=NULL`, `password_must_reset=true`.

> ⚠️ CSV-файлы содержат email + хэши паролей. Директория `exports/` уже
> в `.gitignore`. После импорта удалите её или зашифруйте.

---

## 4. (Только при cutover) Импорт CSV в Yandex

```bash
export YANDEX_DB_URL="$DATABASE_URL"
bash scripts/migrate-db/import-to-yandex.sh "$EXPORT_DIR"
```

Что произойдёт:

1. Pre-check: `psql` есть, env есть, в `EXPORT_DIR` все 11 CSV.
2. Pre-check: схема `001_init.sql` применена (33 ожидаемые колонки).
3. Pre-check: таблицы пустые (или установлено `ALLOW_NON_EMPTY_TARGET=1` /
   подтверждено в интерактиве).
4. Single-transaction `\copy` 11 таблиц в FK-зависимом порядке.
5. Post-check: `validate-target.sql` ловит orphan'ы и недопустимые
   значения `storage`. RAISE EXCEPTION при дефекте → весь импорт
   откатывается.

Опции:
```bash
bash scripts/migrate-db/import-to-yandex.sh "$EXPORT_DIR" --skip-validate
ALLOW_NON_EMPTY_TARGET=1 bash scripts/migrate-db/import-to-yandex.sh "$EXPORT_DIR"
```

После успеха — финальная проверка:

```bash
psql "$DATABASE_URL" -c "
  SELECT 'app_users' AS t, COUNT(*) FROM app_users UNION ALL
  SELECT 'profiles', COUNT(*) FROM profiles UNION ALL
  SELECT 'projects', COUNT(*) FROM projects UNION ALL
  SELECT 'reports', COUNT(*) FROM reports UNION ALL
  SELECT 'report_photos', COUNT(*) FROM report_photos;"
```

Числа должны совпадать с теми, что были в Supabase (с поправкой на
`auth.users.deleted_at IS NOT NULL` — такие отфильтровываются на экспорте).

---

## 5. Bootstrap первого администратора

Если в БД уже есть импортированные пользователи и среди них был admin —
шаг можно пропустить. Иначе:

### Вариант А: через UI регистрации

```bash
# Запустите backend + frontend (см. шаг 6) и зарегистрируйте пользователя
# через /register. Он создастся с role='user', is_active=false.

# Затем повысьте до админа:
psql "$DATABASE_URL" -c "
  UPDATE profiles SET role='admin', is_active=true
  WHERE id IN (SELECT id FROM app_users WHERE email='you@example.com');"
```

### Вариант Б: SQL прямо

```bash
# Используйте только если в БД нет админа после импорта:
EMAIL="admin@example.com"
PASSWORD_HASH=$(node -e "
  const bcrypt = require('bcryptjs');
  console.log(bcrypt.hashSync(process.argv[1], 12));
" 'YourStrongPassword!')

psql "$DATABASE_URL" <<SQL
WITH inserted AS (
  INSERT INTO app_users (email, password_hash, password_must_reset)
  VALUES ('$EMAIL', '$PASSWORD_HASH', false)
  RETURNING id
)
INSERT INTO profiles (id, full_name, role, is_active)
SELECT id, 'Администратор', 'admin', true FROM inserted;
SQL
```

После этого можно логиниться через `/login`.

---

## 6. Запуск backend и frontend

### 6.1 Production

Backend:
```bash
# В директории проекта:
npm run server:start
# Слушает на $HOST:$PORT (по умолчанию 0.0.0.0:4000).
```

Перед фронтом — reverse proxy (nginx / Caddy / haproxy), который
проксирует `/api/*` на `localhost:4000`. Пример nginx:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# SPA-fallback: всё остальное → index.html
location / {
    root /var/www/stroyfoto/dist;
    try_files $uri $uri/ /index.html;
}
```

Frontend:
```bash
# Содержимое dist/ положить на статический хост (Cloudflare Pages,
# Netlify, S3+CF, или тот же nginx).
# SPA-fallback на index.html — обязательно.
```

### 6.2 Dev / smoke на локальной машине

```bash
npm run dev:all
# Поднимется vite на http://localhost:5173 и Fastify на :4000.
# /api проксируется через VITE_API_URL=http://localhost:4000/api в .env
# (или через ручной reverse proxy).
```

---

## 7. Health-проверки

После старта backend:

```bash
curl http://localhost:4000/api/health
# {"ok":true}

curl http://localhost:4000/api/db-health
# {"ok":true,"latencyMs":...}
```

Если `db-health` возвращает 500 — проверьте `DATABASE_URL` и сетевой
доступ (Yandex MDB IP whitelist).

---

## 8. Smoke-тесты

### 8.1 Auth

Через UI (`http://localhost:5173`):

| Сценарий | Ожидание |
|---|---|
| Login admin | Редирект на `/reports`, видны все проекты |
| Login active user | Редирект на `/reports`, видны только проекты из membership |
| Login inactive user | Редирект на `/pending-activation` |
| Logout | Редирект на `/login`, `accessToken` стёрт |
| Refresh | После 15 мин (или `ACCESS_TOKEN_TTL=1m` для теста) следующий запрос → прозрачный POST `/api/auth/refresh` |
| Login юзером с `password_hash=NULL` | `INVALID_CREDENTIALS` (ограничение MVP — нужен manual reset через psql) |

### 8.2 Admin

| Действие | Endpoint | Проверка |
|---|---|---|
| Список users | GET `/api/admin/profiles` | Все пользователи + email |
| Активация | PATCH `/api/admin/profiles/:id/active` | `is_active=true` в БД |
| Назначение проектов | PUT `/api/admin/profiles/:userId/projects` | Записи в `project_memberships` |
| Projects CRUD | `/api/admin/projects` | Создание/изменение/удаление |
| Work-types CRUD | `/api/admin/work-types` | citext-уникальность по name |
| Work-assignments CRUD | `/api/admin/work-assignments` | то же |
| Performers CRUD | `/api/admin/performers` | kind = `contractor` / `own_forces` |

### 8.3 Reports (online)

1. `/reports/new` → выбрать проект → вид работ → исполнитель.
2. Загрузить 1–2 фото (камера или галерея).
3. Submit → запись `reports` + `report_photos` в БД, JPEG'и в Cloud.ru.
4. `/reports/:id` → видны фото и точка на плане (если ставили).

### 8.4 Reports (offline → sync)

1. DevTools → Network → Offline.
2. Создать отчёт + фото → submit. UI: статус «pending».
3. Снять Offline. Подождать ≤30 секунд (sync loop).
4. В DevTools видны успешные POST'ы. Запись в БД и Cloud.ru.

### 8.5 Plans

1. `/plans` (admin или член проекта) → upload PDF.
2. Plan скачивается через presigned GET, рендерится в pdfjs.
3. В `/reports/new` выбрать план → клик по странице → отметка
   с `(x_norm, y_norm) ∈ [0..1]`.

### 8.6 Access control (через curl)

Нужны два пользователя:
- `user_a@x` — член проекта `A`.
- `user_b@x` — член проекта `B`.

```bash
TOKEN_A=$(curl -sX POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"user_a@x","password":"..."}' | jq -r '.session.accessToken')

# 1) Чужой report
curl -i -H "authorization: Bearer $TOKEN_A" \
  http://localhost:4000/api/reports/<report_id_из_проекта_B>
# Ожидаем 403 FORBIDDEN

# 2) Попытка изменить роль (zod должен отклонить)
curl -iX PATCH http://localhost:4000/api/profile \
  -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
  -d '{"role":"admin","is_active":true}'
# Ожидаем 400 VALIDATION_ERROR (только full_name разрешён)

# 3) Presign к чужому отчёту
curl -iX POST http://localhost:4000/api/storage/presign \
  -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
  -d '{"op":"put","kind":"photo","key":"photos/<чужой_report>/<photo>.jpg","reportId":"<чужой_report>","contentType":"image/jpeg"}'
# Ожидаем 403 FORBIDDEN

# 4) Presign к R2 (только админ)
curl -iX POST http://localhost:4000/api/storage/presign \
  -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
  -d '{"op":"get","kind":"photo","key":"photos/<own>/<photo>.jpg","reportId":"<own>","provider":"r2"}'
# Ожидаем 403 FORBIDDEN

# 5) Попытка пометить фото с storage='r2' (после фикса P2.4)
curl -iX PUT http://localhost:4000/api/report-photos/<photo_id> \
  -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
  -d '{"report_id":"<own>","r2_key":"photos/<own>/<photo>.jpg","thumb_r2_key":null,"width":null,"height":null,"taken_at":null,"storage":"r2"}'
# Ожидаем 403 FORBIDDEN

# 6) plan_id из чужого проекта в setPlanMark
curl -iX PUT "http://localhost:4000/api/reports/<own_report>/plan-mark" \
  -H "authorization: Bearer $TOKEN_A" -H 'content-type: application/json' \
  -d '{"plan_id":"<plan_id_из_проекта_B>","page":1,"x_norm":0.5,"y_norm":0.5}'
# Ожидаем 400 VALIDATION_ERROR ("plan_id не относится к проекту отчёта")

# 7) Тот же тест от имени admin — должен работать
TOKEN_ADMIN=$(curl -sX POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@x","password":"..."}' | jq -r '.session.accessToken')

curl -i -H "authorization: Bearer $TOKEN_ADMIN" \
  http://localhost:4000/api/admin/profiles
# Ожидаем 200 OK + полный список
```

### 8.7 Storage migration page

Только если есть данные в Cloudflare R2.

1. Войти админом.
2. `/admin/storage-migration`. На странице — счётчики «Осталось переехать»
   (фото R2 / планы R2).
3. Кнопка «Запустить» → каждая строка `storage='r2'`:
   - GET по presigned URL из R2.
   - PUT по presigned URL в Cloud.ru (тот же object key).
   - PATCH `/api/storage-migration/report-photos/:id/storage` (или
     `/plans/:id/storage`) с `expected_storage='r2'` → `storage='cloudru'`.
4. После завершения — счётчики обнулены, объекты в Cloud.ru.

> Страница идемпотентна. Если что-то упало посреди прогона — обновите
> страницу и нажмите «Запустить» повторно.

После успеха можно отозвать R2-ключи и удалить ветку `provider==='r2'`
из presign-сервиса.

---

## 9. Откат / rollback

### 9.1 Если миграция БД упала на этапе schema/import

Single-transaction уже откатил всё. Просто исправьте источник ошибки и
перезапустите. Для полной очистки:

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
DATABASE_URL=... npm run migrate:db
```

### 9.2 Если cutover на проде сорвался

- Никаких изменений в Supabase скрипты не делают (все экспорты read-only).
- Yandex БД остаётся в том состоянии, в котором её оставила
  single-transaction (либо пустая, либо полностью импортированная).
- DNS/reverse-proxy: верните старый origin, фронт продолжит работать
  с Supabase до устранения проблемы.

### 9.3 Если нужно стереть Yandex БД и начать заново

```bash
psql "$DATABASE_URL" <<SQL
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
SQL
DATABASE_URL=... npm run migrate:db
```

---

## 10. Известные ограничения / открытые вопросы

| Вопрос | Статус | План |
|---|---|---|
| Forgot-password / reset-password | ❌ Не реализовано | Отдельный промт. Пока — admin создаёт пароли через psql / argon2-cli. |
| `password_hash=NULL` после import | ⚠️  Login отвечает дженерик `INVALID_CREDENTIALS` | Связано с предыдущим. Workaround — UPDATE через psql. |
| Server push (WS/SSE/LISTEN-NOTIFY) | ❌ Не реализовано | Polling sync 30/120с + BroadcastChannel cross-tab — работает, но обновления между устройствами с задержкой до 30с. |
| `engines` в `package.json` | ⚠️  Нет | Defensive, не блокер. |
| `smoke:staging` Playwright | ⚠️  Нет | Полезно для CI, не блокер cutover. |

---

## 11. Команды-шпаргалка

```bash
# Подготовка
npm install
npm run typecheck
npm run build
npm run server:build

# Применить миграции на пустую БД
DATABASE_URL=postgres://... npm run migrate:db

# Экспорт из Supabase (опц)
SUPABASE_DB_URL=postgres://... bash scripts/migrate-db/export-from-supabase.sh

# Импорт в Yandex (опц)
YANDEX_DB_URL=$DATABASE_URL bash scripts/migrate-db/import-to-yandex.sh <export-dir>

# Запуск
npm run server:start            # backend prod
npm run dev:all                 # vite + fastify, локально

# Health
curl http://localhost:4000/api/health
curl http://localhost:4000/api/db-health
```
