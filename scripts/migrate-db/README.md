# Миграция БД: Supabase.com → Yandex Managed PostgreSQL

Скрипты переноса application-данных из Supabase.com в собственный Postgres
(Yandex MDB) для отказа от Supabase Auth/PostgREST/Realtime в пользу Fastify
backend. Контекст и обоснование — в [`MIGRATION_AUDIT.md`](../../MIGRATION_AUDIT.md).

В отличие от схемного дампа (`supabase/migrations/prod.sql`), эти скрипты
переносят **только** `public.*` + срез `auth.users` через `JOIN public.profiles`.
Supabase internals (`auth.*` кроме среза, `storage.*`, `realtime.*`, `vault.*`,
audit logs, sessions, OAuth state, MFA factors, supabase-роли) не переносятся.

## Что делает

```
┌─────────────────────────┐    ┌──────────────────────────┐    ┌──────────────────────┐
│ export-from-supabase.sh │ →  │ scripts/db/apply-        │ →  │ import-to-yandex.sh  │
│  Supabase → CSV         │    │ migrations.sh (схема)    │    │  CSV → Yandex MDB    │
└─────────────────────────┘    └──────────────────────────┘    └──────────────────────┘
        │                                                                │
        └─→ validate-source.sql (pre-flight)         validate-target.sql ←┘
            * schema preconditions (fatal)            * counts
            * counts                                  * orphan checks (fatal)
            * password breakdown                      * storage check (fatal)
            * source-side orphans (info)
```

## Предусловия

- `psql` ≥ 14 в PATH.
- Доступ к Supabase Postgres по прямому connection string (не PgBouncer):
  Dashboard → Settings → Database → **Connection string (Direct)**.
- Доступ к Yandex MDB через PgBouncer (порт 6432, `sslmode=verify-full`).
- К целевой БД применены миграции `db/migrations/*.sql` через
  [`scripts/db/apply-migrations.sh`](../db/apply-migrations.sh) — иначе импорт
  упадёт со schema check error.
- Linux/macOS или Git Bash / WSL на Windows. Файлы скриптов в LF (не CRLF).

## Env переменные

| Переменная | Где | Описание |
|---|---|---|
| `SUPABASE_DB_URL` | export | `postgres://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require` |
| `YANDEX_DB_URL` | import | `postgres://<user>:<password>@<host>:6432/<db>?sslmode=verify-full` |
| `EXPORT_DIR` | export, import | путь к директории с CSV. Альтернатива позиционному аргументу. |
| `ALLOW_NON_EMPTY_TARGET` | import | `1` — пропустить guard на непустые таблицы. Используйте в CI. |

## Безопасность

**CSV содержат email и (для bcrypt-формата) password hashes.** Папка
`scripts/migrate-db/exports/` уже добавлена в `.gitignore` — не коммитьте,
не передавайте по незащищённым каналам, удалите после успешного cutover.

## Пошаговый запуск

### 1. Экспорт из Supabase (read-only)

```bash
SUPABASE_DB_URL='postgres://postgres:...@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
  bash scripts/migrate-db/export-from-supabase.sh
```

Скрипт:
1. Запустит `validate-source.sql` (упадёт, если Supabase-схема не такая, как ожидаем).
2. Создаст `scripts/migrate-db/exports/<UTC-timestamp>/` (или возьмёт `EXPORT_DIR`
   / позиционный аргумент).
3. Сделает `\copy` 11 запросов в CSV.
4. Напечатает абсолютный путь export-dir последней строкой stdout.

Захватить путь для следующего шага:
```bash
EXPORT_DIR=$(SUPABASE_DB_URL='...' bash scripts/migrate-db/export-from-supabase.sh | tail -1)
echo "Exported to: $EXPORT_DIR"
```

### 2. Применить схему на чистый Yandex MDB

Если миграции ещё не применены:
```bash
DATABASE_URL='postgres://...:6432/db?sslmode=verify-full' \
  bash scripts/db/apply-migrations.sh
```

### 3. Импорт

```bash
YANDEX_DB_URL='postgres://...:6432/db?sslmode=verify-full' \
  bash scripts/migrate-db/import-to-yandex.sh "$EXPORT_DIR"
```

Что делает:
1. Проверяет, что 001_init применён (наличие ключевых колонок).
2. Считает строки в каждой целевой таблице. Если есть данные — спросит
   подтверждение в tty или потребует `ALLOW_NON_EMPTY_TARGET=1` в CI.
3. Импортирует все 11 CSV в **одной транзакции**. Любая FK/PK ошибка
   откатывает всё — БД остаётся в исходном состоянии.
4. Запускает `validate-target.sql` (orphans + storage check). Любое нарушение
   → `RAISE EXCEPTION` → ненулевой exit code импорта.

## Пароли и forgot/reset flow

**Backend на argon2id, Supabase — bcrypt с server-side pepper.** Это означает:

- Bcrypt-хеши, которые экспорт вытащит из `auth.users.encrypted_password`,
  с большой вероятностью **не пройдут валидацию** в новом backend, даже если
  оба используют bcrypt: Supabase солит хеш своим `pepper`, недоступным извне.
- Скрипт уже выставит `password_must_reset=true` для всего, что не bcrypt-формата
  (формат проверяется regex `^\$2[aby]\$`). Для bcrypt-формата флаг будет
  `false`, но это **оптимистичное предположение**.

**Рекомендация:** после импорта прогнать
```sql
UPDATE public.app_users SET password_must_reset = true;
```
— это страховка на случай отличающегося pepper.

**КРИТИЧНО:** на дату 2026-05-02 backend **ещё не реализует** endpoint'ы
forgot/reset password (`POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
запланированы как этап 1 из [MIGRATION_AUDIT.md §5](../../MIGRATION_AUDIT.md), но
не написаны). До их реализации после cutover пользователи не смогут залогиниться.

**Не запускать cutover, пока flow не готов.** Альтернатива — сбрасывать пароли
вручную через psql + `argon2-cli` для известных тестовых учёток.

## Идемпотентность / повторный запуск

Скрипты не делают UPSERT/TRUNCATE/DISABLE TRIGGER — это намеренно. Импорт
работает в одной транзакции, любая ошибка откатывает всё.

Чтобы перезапустить импорт начисто:

```bash
# Вариант 1: TRUNCATE в обратном FK-порядке.
psql "$YANDEX_DB_URL" <<'SQL'
TRUNCATE TABLE
  public.report_photos,
  public.report_plan_marks,
  public.reports,
  public.plans,
  public.performers,
  public.work_assignments,
  public.work_types,
  public.project_memberships,
  public.projects,
  public.profiles,
  public.app_users
RESTART IDENTITY CASCADE;
SQL

# Вариант 2: дроп схемы и повторное применение миграций.
psql "$YANDEX_DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
DATABASE_URL="$YANDEX_DB_URL" bash scripts/db/apply-migrations.sh
```

Просто запустить импорт повторно с `ALLOW_NON_EMPTY_TARGET=1` — приведёт
к падению на duplicate primary key внутри транзакции (откатится всё).

## Что НЕ переносится

| Schema/таблица | Почему |
|---|---|
| `auth.*` (кроме среза) | Свой backend, своя auth-схема (`public.app_users`, `refresh_tokens`) |
| `storage.*` | Файлы в Cloud.ru S3 / R2 — отдельная процедура |
| `realtime.*`, `vault.*`, `pgsodium.*` | Supabase internals |
| Supabase-роли (`anon`, `authenticated`, `service_role`, ...) | Не нужны без PostgREST |
| `refresh_tokens` (Supabase) | Новые сессии создаются с нуля; пользователи перелогинятся |
| Audit logs, MFA factors, OAuth state | Не используются |

## Хранилище

Колонки `r2_key`, `thumb_r2_key` и `storage` (`'cloudru' | 'r2'`) переносятся
как есть. Файлы в R2/Cloud.ru эти скрипты **не трогают** — для переноса
объектов используется отдельная админ-страница `/admin/storage-migration`
(после того, как backend поднят на новой БД).

## Структура

```
scripts/migrate-db/
├── export-from-supabase.sh   # Bash + psql \copy TO
├── import-to-yandex.sh       # Bash + psql \copy FROM (single transaction)
├── validate-source.sql       # schema preconditions + diagnostics
├── validate-target.sql       # counts + orphans + storage (fatal)
├── README.md
└── exports/                  # сгенерированные CSV (в .gitignore)
    └── <UTC-timestamp>/
        ├── app_users.csv
        ├── profiles.csv
        ├── projects.csv
        ├── project_memberships.csv
        ├── work_types.csv
        ├── work_assignments.csv
        ├── performers.csv
        ├── plans.csv
        ├── reports.csv
        ├── report_plan_marks.csv
        └── report_photos.csv
```

## Troubleshooting

| Симптом | Что проверять |
|---|---|
| `ERROR: schema check failed` при импорте | Применён ли `db/migrations/001_init.sql`. |
| `psql: error: connection to server failed` | URL формата (с `sslmode`), IP-whitelist для Yandex MDB. |
| `auth.users missing columns` в validate-source | Supabase обновил схему — добавьте недостающие колонки в проверку. |
| `RAISE EXCEPTION '<N> ... orphans'` в validate-target | Несогласованные данные в источнике — проверьте `validate-source.sql` на source-orphans. |
| Импорт упал на `duplicate key value violates unique constraint` | В target уже есть данные — TRUNCATE или DROP SCHEMA, см. секцию «Идемпотентность». |
| `\copy` падает на `permission denied` | Проверьте, что путь к CSV абсолютный и доступен на чтение из текущего пользователя. |
