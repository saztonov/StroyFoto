-- ============================================================================
-- Миграция на Cloud.ru S3 (s3.cloud.ru) вместо Cloudflare R2
-- ============================================================================
-- Добавляет колонку `storage` в таблицы, ссылающиеся на бинарные объекты в
-- объектном хранилище. Существующие строки получают значение 'r2' (legacy
-- Cloudflare R2). Новые загрузки выставляют 'cloudru' через клиент.
--
-- После миграции исторических объектов на Cloud.ru S3 значение колонки
-- обновляется на 'cloudru' (см. страницу /admin/storage-migration).
--
-- Колонка `r2_key` НЕ переименовывается — это путь к объекту, имя историческое
-- и одинаковое в обоих хранилищах. Меняется только хост endpoint'а, который
-- определяется по провайдеру.
-- ============================================================================

alter table public.report_photos
  add column if not exists storage text not null default 'r2';

alter table public.plans
  add column if not exists storage text not null default 'r2';

-- Изменим default на 'cloudru', чтобы новые строки, вставляемые без явного
-- значения, попадали на Cloud.ru. Существующие строки сохраняют 'r2'.
alter table public.report_photos
  alter column storage set default 'cloudru';

alter table public.plans
  alter column storage set default 'cloudru';

-- Гарантия валидных значений (мягкая валидация на уровне БД)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'report_photos_storage_chk'
  ) then
    alter table public.report_photos
      add constraint report_photos_storage_chk
      check (storage in ('r2', 'cloudru'));
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'plans_storage_chk'
  ) then
    alter table public.plans
      add constraint plans_storage_chk
      check (storage in ('r2', 'cloudru'));
  end if;
end$$;

-- ============================================================================
-- Realtime: storage-колонка уже попадёт в стандартные postgres_changes events,
-- никакой настройки публикаций не требуется.
-- ============================================================================
