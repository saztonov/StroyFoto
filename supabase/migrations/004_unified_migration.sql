-- ============================================================
-- Единый скрипт миграции БД СтройФото
-- Объединяет: 002_admin_features + 003_dictionary_aliases + 003_offline_sync_cleanup
-- Применять к текущей production БД (Supabase)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PROFILES: добавить is_active
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ============================================================
-- 2. VERIFICATION: проверить что нужные колонки на месте
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'work_types'
  ) THEN
    RAISE EXCEPTION 'Column reports.work_types does not exist';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'own_forces'
  ) THEN
    RAISE EXCEPTION 'Column reports.own_forces does not exist';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_projects'
  ) THEN
    RAISE EXCEPTION 'Table user_projects does not exist';
  END IF;
END $$;

-- ============================================================
-- 3. DEPRECATED COLUMNS: мигрировать данные work_type → work_types[]
-- ============================================================

UPDATE public.reports
SET work_types = ARRAY[work_type]
WHERE work_type IS NOT NULL
  AND work_type != ''
  AND (work_types IS NULL OR work_types = '{}');

-- ============================================================
-- 4. DICTIONARY_ALIASES: таблица алиас-истории
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dictionary_aliases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  dictionary_type text NOT NULL,
  item_id uuid NOT NULL,
  alias_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_alias_type_name UNIQUE (dictionary_type, alias_name)
);

CREATE INDEX IF NOT EXISTS idx_dict_aliases_type_name
  ON public.dictionary_aliases (dictionary_type, lower(alias_name));

CREATE INDEX IF NOT EXISTS idx_dict_aliases_item_id
  ON public.dictionary_aliases (item_id);

-- ============================================================
-- 5. RPC: атомарное переименование записи справочника
--    Проверяет конфликты, пишет алиас, обновляет каноническое имя,
--    каскадно переписывает отчёты
-- ============================================================

CREATE OR REPLACE FUNCTION public.rename_dictionary_item(
  p_dict_type text,
  p_table_name text,
  p_item_id uuid,
  p_new_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_name text;
  v_conflict_id uuid;
BEGIN
  -- Получить текущее имя
  EXECUTE format('SELECT name FROM public.%I WHERE id = $1', p_table_name)
    INTO v_old_name USING p_item_id;

  IF v_old_name IS NULL THEN
    RAISE EXCEPTION 'Item not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_old_name = p_new_name THEN
    RETURN;
  END IF;

  -- Проверить конфликт с каноническим именем (case-insensitive)
  EXECUTE format('SELECT id FROM public.%I WHERE lower(name) = lower($1) AND id != $2', p_table_name)
    INTO v_conflict_id USING p_new_name, p_item_id;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Name already exists' USING ERRCODE = '23505';
  END IF;

  -- Проверить конфликт с алиасом
  SELECT id INTO v_conflict_id
    FROM public.dictionary_aliases
    WHERE dictionary_type = p_dict_type
      AND lower(alias_name) = lower(p_new_name);

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'Name conflicts with existing alias' USING ERRCODE = '23505';
  END IF;

  -- Записать старое имя как алиас
  INSERT INTO public.dictionary_aliases (dictionary_type, item_id, alias_name)
    VALUES (p_dict_type, p_item_id, v_old_name)
    ON CONFLICT (dictionary_type, alias_name) DO NOTHING;

  -- Обновить каноническое имя
  EXECUTE format('UPDATE public.%I SET name = $1, updated_at = now() WHERE id = $2', p_table_name)
    USING p_new_name, p_item_id;

  -- Каскадное обновление отчётов
  IF p_dict_type = 'work_types' THEN
    UPDATE public.reports
      SET work_types = array_replace(work_types, v_old_name, p_new_name),
          updated_at = now()
      WHERE v_old_name = ANY(work_types);
  ELSIF p_dict_type = 'contractors' THEN
    UPDATE public.reports
      SET contractor = p_new_name, updated_at = now()
      WHERE contractor = v_old_name;
  ELSIF p_dict_type = 'own_forces' THEN
    UPDATE public.reports
      SET own_forces = p_new_name, updated_at = now()
      WHERE own_forces = v_old_name;
  END IF;
END;
$$;

-- ============================================================
-- 6. INDEXES: производительность каскадных UPDATE и запросов
-- ============================================================

-- Для каскадного переименования
CREATE INDEX IF NOT EXISTS idx_reports_contractor
  ON public.reports (contractor);

CREATE INDEX IF NOT EXISTS idx_reports_own_forces
  ON public.reports (own_forces);

CREATE INDEX IF NOT EXISTS idx_reports_work_types
  ON public.reports USING GIN (work_types);

-- Для project-based sync/pull запросов
CREATE INDEX IF NOT EXISTS idx_reports_project_sync_updated
  ON public.reports (project_id, sync_status, updated_at);

-- Для finalization проверки фото
CREATE INDEX IF NOT EXISTS idx_photos_report_upload_status
  ON public.photos (report_id, upload_status);

-- ============================================================
-- 7. DATA INTEGRITY: проверка целостности данных
-- ============================================================

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.photos p
  LEFT JOIN public.reports r ON p.report_id = r.id
  WHERE r.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE WARNING '% orphaned photo(s) found (referencing deleted reports)', orphan_count;
  END IF;
END $$;

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.reports r
  LEFT JOIN public.projects p ON r.project_id = p.id
  WHERE p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE WARNING '% report(s) reference non-existent projects', orphan_count;
  END IF;
END $$;

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.user_projects up
  LEFT JOIN public.profiles p ON up.user_id = p.id
  WHERE p.id IS NULL;
  IF orphan_count > 0 THEN
    RAISE WARNING '% user_project assignment(s) reference non-existent profiles', orphan_count;
  END IF;
END $$;

COMMIT;
