-- 003_cloudru_only_object_keys.sql
-- Финал миграции R2 → Cloud.ru: убираем dual-storage из схемы.
--   1) Sanity check: убедиться, что не осталось строк с storage <> 'cloudru'.
--   2) Удалить CHECK-ограничения на колонке storage.
--   3) Удалить колонку storage в plans и report_photos.
--   4) Переименовать r2_key → object_key, thumb_r2_key → thumb_object_key.
--
-- Применять ТОЛЬКО после того, как все строки уже имеют storage='cloudru'.
-- Идемпотентна по конструкциям IF EXISTS, но повторный RENAME упадёт —
-- запускайте один раз на инициализированной БД.

BEGIN;

-- Sanity check: не дать срезать данные, если миграция объектов ещё не закончена.
DO $$
DECLARE
  cnt_p  int;
  cnt_ph int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'storage'
  ) THEN
    SELECT count(*) INTO cnt_p FROM public.plans WHERE storage <> 'cloudru';
  ELSE
    cnt_p := 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'report_photos' AND column_name = 'storage'
  ) THEN
    SELECT count(*) INTO cnt_ph FROM public.report_photos WHERE storage <> 'cloudru';
  ELSE
    cnt_ph := 0;
  END IF;

  IF cnt_p > 0 OR cnt_ph > 0 THEN
    RAISE EXCEPTION
      'Найдены строки со storage <> cloudru: plans=%, photos=%. Сначала допроведи миграцию объектов в Cloud.ru.',
      cnt_p, cnt_ph;
  END IF;
END
$$;

-- plans
ALTER TABLE public.plans DROP CONSTRAINT IF EXISTS plans_storage_chk;
ALTER TABLE public.plans DROP COLUMN     IF EXISTS storage;
ALTER TABLE public.plans RENAME COLUMN r2_key TO object_key;

-- report_photos
ALTER TABLE public.report_photos DROP CONSTRAINT IF EXISTS report_photos_storage_chk;
ALTER TABLE public.report_photos DROP COLUMN     IF EXISTS storage;
ALTER TABLE public.report_photos RENAME COLUMN r2_key       TO object_key;
ALTER TABLE public.report_photos RENAME COLUMN thumb_r2_key TO thumb_object_key;

COMMIT;
