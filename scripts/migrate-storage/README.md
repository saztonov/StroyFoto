# CLI миграции файлов: Cloudflare R2 → Cloud.ru S3

Командная утилита для разового переноса всех бинарных объектов
(`report_photos.r2_key`, `report_photos.thumb_r2_key`, `plans.r2_key`)
из Cloudflare R2 в Cloud.ru Object Storage (`s3.cloud.ru`,
регион `ru-central-1`) с одновременным обновлением колонки `storage`
в Supabase на `'cloudru'`.

В отличие от UI-миграции [`/admin/storage-migration`](../../src/pages/admin/StorageMigrationPage.tsx),
которая ходит через Edge Function и presigned URL'ы, CLI работает
**напрямую**:

* Supabase service-role key (обходит RLS, видит все строки).
* Прямые S3-вызовы по AWS Signature V4 в R2 и Cloud.ru через
  [`aws4fetch`](https://github.com/mhart/aws4fetch).
* Параллелизм 4–32 потоков, JSONL-лог ошибок, idempotent retry.

Это в десятки раз быстрее, не зависит от живости Edge Function и
устойчиво к перерывам — после остановки можно перезапустить, перенесёт
только то, что осталось.

## Архитектура — три фазы

```
┌──────────┐       ┌────────┐       ┌──────────┐
│  check   │  →    │  run   │  →    │  verify  │
└──────────┘       └────────┘       └──────────┘
 preflight       копирование        проверка
 без изменений    R2 → Cloud.ru     консистентности
```

### 1. `check` — preflight (read-only)

* Проверяет, что `.env.migrate` загрузился и обязательные переменные
  заданы.
* Ходит в Supabase service-role'ом, убеждается что колонка `storage`
  существует.
* Делает round-trip к Cloud.ru: `PUT` → `HEAD` → `GET` → `DELETE`
  тестового объекта в `_migration-check/<uuid>.bin`.
* Делает `HEAD` на одной случайной строке `storage='r2'` чтобы
  убедиться, что R2-ключ читаем.
* Печатает сводку: сколько объектов в очереди.
* Не меняет ни данных, ни БД. Exit code 0 = ок, 1 = блокер.

### 2. `run` — собственно миграция

Для каждой строки `storage='r2'`:

1. `HEAD` объекта в Cloud.ru. Если объект уже там — пропускаем
   `GET`/`PUT` (skip-copy) и сразу обновляем БД. Это сценарий после
   неудачного предыдущего запуска: данные в Cloud.ru уже есть, не
   хватало только апдейта строки.
2. `GET` с R2 → `PUT` в Cloud.ru с тем же object key.
3. `UPDATE storage='cloudru' WHERE id=$1 AND storage='r2'` — защита
   от гонки (если кто-то параллельно перенёс эту строку, наш UPDATE
   просто вернёт 0 rows и засчитается как `race-lost`).

Любая ошибка для конкретного объекта пишется в `migration-errors.jsonl`
и не прерывает остальную работу. После завершения — exit code 2 если
были провалы, 0 если всё ок.

Идемпотентно: после восстановления связи / исправления конфигурации
просто перезапустите `run`.

### 3. `verify` — финальная проверка (read-only)

* Проверяет, что строк со `storage='r2'` не осталось.
* Для каждой (или sample N) строки `storage='cloudru'` делает HEAD
  в Cloud.ru — объект должен быть.
* Опционально (`--compare-r2`) HEAD'ает тот же объект в R2 и
  сравнивает размеры (длинна = идентичный байт-в-байт перенос с
  достаточно высокой вероятностью).

Exit code 0 = всё ок, 1 = найдены несоответствия.

## Установка и подготовка

### 1. Применить SQL-миграцию в Supabase

```sql
-- supabase/migrations/20260501_cloudru_storage.sql
-- Добавляет колонку storage в report_photos и plans.
```

Запустите её в Supabase Dashboard → SQL Editor (или `psql -f`).

### 2. Завести бакет в Cloud.ru и получить ключи

1. [cloud.ru](https://cloud.ru) → Object Storage → создать бакет (например `stroyfoto`).
2. Создать персональный или сервисный access key (Key ID + Key Secret).
3. Скопировать Tenant ID (показан над списком бакетов).
4. Настроить CORS на бакете (для UI-миграции; для CLI не нужен,
   утилита работает с server-side).

### 3. Скопировать .env.migrate.example → .env.migrate

```bash
cp scripts/migrate-storage/.env.migrate.example .env.migrate
```

Заполните своими значениями:

| Переменная                  | Назначение                                       |
| --------------------------- | ------------------------------------------------ |
| `SUPABASE_URL`              | Прямой URL Supabase, **не reverse proxy**        |
| `SUPABASE_SERVICE_ROLE_KEY` | service\_role JWT (Supabase Dashboard → Settings → API) |
| `R2_ACCOUNT_ID`             | Account ID Cloudflare                            |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | API token к R2                  |
| `R2_BUCKET`                 | Имя бакета R2                                    |
| `CLOUDRU_TENANT_ID`         | Идентификатор тенанта Cloud.ru                   |
| `CLOUDRU_KEY_ID` / `CLOUDRU_KEY_SECRET` | Ключ доступа Cloud.ru                |
| `CLOUDRU_BUCKET`            | Имя бакета в Cloud.ru                            |
| `CLOUDRU_ENDPOINT`          | (опц.) default `https://s3.cloud.ru`            |
| `CLOUDRU_REGION`            | (опц.) default `ru-central-1`                    |

> Файл `.env.migrate` находится в `.gitignore` — в репозитории его нет
> и не должно быть.

### 4. Прогнать preflight

```bash
npm run migrate:storage:check
```

Должно вывести что-то вроде:

```
✓ Конфигурация .env.migrate загружена
✓ Supabase: колонка `storage` присутствует в report_photos и plans
✓ Supabase: записи прочитаны (фото r2=12345, plans r2=42)
✓ Cloud.ru PUT прошёл (_migration-check/...)
✓ Cloud.ru HEAD прошёл
✓ Cloud.ru GET вернул ровно те же байты
✓ Cloud.ru DELETE убрал probe-объект
✓ R2 HEAD на пробной фотографии: size=145623B
...
✓ Preflight OK. Можно запускать `npm run migrate:storage:run`.
```

Если что-то упало — исправьте и повторите check, прежде чем запускать
миграцию.

### 5. Прогон `run`

```bash
# Базовый запуск (concurrency=4, retries=3)
npm run migrate:storage:run

# Можно поднять concurrency, если канал и Cloud.ru тянут
npm run migrate:storage -- run --concurrency=12

# Тестовый запуск без записи (только HEAD'ы и подсчёт)
npm run migrate:storage -- run --dry-run --limit=20

# Только фотки или только планы
npm run migrate:storage -- run --only=photos
npm run migrate:storage -- run --only=plans
```

Прогресс отображается перезаписываемой строкой:

```
progress 1234/56789 (2.2%)  copied=1200  skip=20  fail=14  482.5MB
```

### 6. Verify

```bash
# Полный прогон: HEAD каждый объект на Cloud.ru
npm run migrate:storage:verify

# Случайная выборка из 200 строк (быстро)
npm run migrate:storage -- verify --sample=200

# Сравнить размеры с R2 (надёжно перед удалением R2)
npm run migrate:storage -- verify --compare-r2
```

### 7. Когда verify зелёный — отозвать R2

Когда `verify` вернул 0 и счётчик `Осталось со storage=r2` = 0,
можно убрать R2-секреты:

```bash
supabase secrets unset R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
```

После этого ветка `provider==='r2'` в Edge Function `sign` фактически
не используется и её можно удалить.

## Журнал ошибок

Все фатальные ошибки по конкретным объектам пишутся в
`./migration-errors.jsonl` (или путь из `--errors-log=...`):

```jsonl
{"at":"2026-05-01T...","table":"report_photos","rowId":"...","key":"photos/.../...-thumb.jpg","kind":"photo_thumb","step":"r2Get","error":"GET R2 photos/...: 503"}
```

Строка JSON на каждый сбой — удобно фильтровать через `jq`:

```bash
jq -r 'select(.step == "r2Get") | .key' migration-errors.jsonl
```

После повторного запуска `run` журнал **дописывается** (не
перезаписывается), чтобы не терять историю.

## Подвохи запуска через npm

`npm run X -- --foo=bar` **не всегда** доводит флаги до скрипта:

* `--env-file` перехватывается **Node 22** даже после имени скрипта —
  поэтому наш флаг называется `--config` (см. ниже).
* `--compare-r2`, `--dry-run` и любые другие нестандартные `--name`
  иногда перехватывает **сам npm** как config-аргумент, выводя
  `npm warn Unknown cli config "--compare-r2"`. Если видите такое —
  значит флаг не передался.

Что делать:

1. Использовать готовый npm-скрипт без флагов:
   `npm run migrate:storage:verify:full` (это `verify --compare-r2`).
2. Или вызывать `node` напрямую, минуя npm:
   `node scripts/migrate-storage/cli.mjs verify --compare-r2 --concurrency=12`

## Имя флага `--config`, а не `--env-file`

Утилита принимает путь к конфигу как `--config=./.env.migrate`. Имя
**намеренно отличается** от Node-built-in `--env-file`: Node 22+
перехватывает свой `--env-file` даже когда тот стоит после имени
скрипта, и пытается сам прочитать указанный файл, не передавая нам.
Поэтому используем `--config`.

## Что делать, если…

* **`401`/`403` от Supabase** — проверьте, что используете именно
  `SUPABASE_SERVICE_ROLE_KEY`, а не anon. И что URL прямой
  (`https://<ref>.supabase.co`), а не reverse proxy.
* **`InvalidAccessKeyId` от Cloud.ru** — composite-ключ собирается
  как `<TENANT_ID>:<KEY_ID>`; убедитесь, что ни один из двух не пустой.
* **`SignatureDoesNotMatch` от R2** — обычно неверный
  `R2_SECRET_ACCESS_KEY` или вы использовали R2 admin-токен вместо
  S3-Compatible API token.
* **`fetch failed`/`ETIMEDOUT`** — сеть/прокси, утилита уже ретраит
  с экспоненциальным backoff. Если падает массово, понизьте
  `--concurrency`.
* **`size mismatch` в verify** — крайне редкая ситуация, обычно
  означает что объект в R2 был частично переписан между PUT в
  Cloud.ru и нашим HEAD. Перезапустите `run` — он перезальёт.

## Ограничения

* Работает только с Node 18+ (нужен глобальный `fetch` и Web Crypto).
* Для очень больших PDF (> 5 GB) понадобится multipart upload —
  на нашем бакете планы редко превышают десятки MB, поэтому реализовано
  одной PUT-операцией. Если у вас есть огромные файлы, добавьте
  multipart в `storage.mjs`.
* CLI не трогает Cloudflare R2-объекты после копирования — они
  остаются. Удалить R2-бакет можно вручную после `verify --compare-r2`,
  чтобы убедиться что данные прижились.
