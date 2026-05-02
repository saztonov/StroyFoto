# StroyFoto — миграции PostgreSQL

Схема для **Yandex Managed Service for PostgreSQL**. Права доступа
реализуются на уровне backend (middleware/service), RLS не используется.

## Расположение

```
db/migrations/
├── 001_init.sql                          # инициализация: extensions, типы, таблицы, индексы, триггеры
├── 002_auth_refresh_tokens.sql           # таблица refresh_tokens
├── 003_cloudru_only_object_keys.sql      # переименование r2_key → object_key, удаление колонки storage
└── README.md                             # этот файл
```

Все миграции — обычные `.sql` файлы, применяются по алфавиту имени. Каждая
обёрнута в `BEGIN; ... COMMIT;` — атомарна.

## Требования к БД

- PostgreSQL **14+** (Yandex MDB рекомендует 15/16).
- Доступные расширения: `pgcrypto`, `citext` (оба в whitelist Yandex MDB по
  умолчанию).
- Подключение — `sslmode=verify-full` для прода (managed-кластер).
- Пользователь, под которым применяется миграция, должен иметь право на
  `CREATE EXTENSION` и владеть схемой `public` (для Yandex MDB обычно это
  владелец БД, созданный при инициализации кластера).

## Применение через `psql`

```bash
# 1. Установите DATABASE_URL (или используйте отдельные переменные).
export DATABASE_URL="postgres://user:password@rc1a-xxxxx.mdb.yandexcloud.net:6432/stroyfoto?sslmode=verify-full"

# 2. Скачайте корневой сертификат Yandex Managed PostgreSQL (один раз):
#    https://storage.yandexcloud.net/cloud-certs/CA.pem
#    Сохраните в ~/.postgresql/root.crt

# 3. Прогоните миграцию:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_init.sql

# 4. Проверка:
psql "$DATABASE_URL" -c '\dt public.*'
psql "$DATABASE_URL" -c '\dT public.*'
```

`-v ON_ERROR_STOP=1` критичен: без него `psql` продолжит выполнение даже
после ошибки в одной из команд.

## Применение через скрипт

```bash
DATABASE_URL="postgres://..." bash scripts/db/apply-migrations.sh
```

Скрипт прогоняет все `db/migrations/*.sql` в алфавитном порядке. Порядок
имён файлов задаётся префиксом `NNN_*` (001, 002, ...). См.
[`scripts/db/apply-migrations.sh`](../../scripts/db/apply-migrations.sh).

## Идемпотентность

`001_init.sql` использует `CREATE ... IF NOT EXISTS` для таблиц/индексов и
`DO $$ BEGIN IF NOT EXISTS ... END $$` для типов, поэтому **повторный
запуск на уже инициализированной БД безопасен** (не упадёт, ничего не
изменит).

> Важно: триггеры (`CREATE TRIGGER`) и функция `set_updated_at` создаются
> через `CREATE OR REPLACE FUNCTION` (для функции) и обычный
> `CREATE TRIGGER` (для триггеров). Если триггер уже существует, второй
> запуск миграции упадёт на `CREATE TRIGGER` с сообщением «trigger already
> exists». Это намеренно — миграция предполагает чистую инициализацию.
> Для повторного применения сначала удалите БД/схему.

## Создание новой миграции

```bash
# Используйте следующий по порядку префикс:
touch db/migrations/002_my_change.sql
```

Внутри:

```sql
BEGIN;

-- ваши DDL/DML

COMMIT;
```

Не модифицируйте уже применённую миграцию — добавляйте новую.

## Что внутри `001_init.sql`

| Блок | Содержимое |
|---|---|
| Extensions | `pgcrypto`, `citext` |
| ENUM | `user_role` (`admin`/`user`), `performer_kind` (`contractor`/`own_forces`) |
| Триггер-функция | `set_updated_at()` (`SET search_path = pg_catalog, pg_temp`) |
| Таблицы | `app_users`, `profiles`, `projects`, `project_memberships`, `work_types`, `work_assignments`, `performers`, `plans`, `reports`, `report_plan_marks`, `report_photos` |
| Триггеры `set_updated_at` | `app_users`, `profiles`, `projects`, `plans`, `reports` |
| Индексы | `profiles(role)`, `project_memberships(user_id)`, `plans(project_id)`, `reports(project_id, created_at desc)`, `reports(author_id)`, `report_photos(report_id)`, `report_plan_marks(plan_id)`, уникальные `lower(projects.name)`, `report_plan_marks(report_id)` |
| Constraints | `page_count > 0 OR null`, `width/height > 0 OR null`, `report_plan_marks.page > 0`, `x_norm/y_norm ∈ [0,1]`, уникальные `(performers.kind, performers.name)`, `work_types.name`, `work_assignments.name` |

## Откат

Полный откат — пересоздать БД (для свежей инсталляции). Партикулярные
откаты пишутся вручную для каждой миграции при необходимости.
