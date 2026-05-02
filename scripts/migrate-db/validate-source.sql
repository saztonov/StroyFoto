-- validate-source.sql
-- Pre-flight проверки исходной Supabase БД перед экспортом.
--
-- Запускается через:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f validate-source.sql
--
-- Поведение:
--   * Schema preconditions (наличие нужных таблиц/колонок) — RAISE EXCEPTION
--     при отсутствии. Это останавливает экспорт до того, как мы начнём
--     писать криво сформированные CSV.
--   * Информационные секции (counts, паролевая статистика, source-orphans,
--     невалидный storage) выводятся через \echo + SELECT и НЕ падают —
--     это диагностика для оператора.

\echo '== validate-source: schema preconditions =='

-- Существуют схемы auth и public.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    RAISE EXCEPTION 'schema "auth" not found — это не Supabase БД';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'public') THEN
    RAISE EXCEPTION 'schema "public" not found';
  END IF;
END
$$;

-- auth.users со всеми нужными колонками.
DO $$
DECLARE
  expected_cols text[] := ARRAY['id','email','encrypted_password','created_at','updated_at','deleted_at'];
  missing       text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(expected_cols) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'auth.users missing columns: %', missing;
  END IF;
END
$$;

-- public.* таблицы и их экспортируемые колонки.
-- Если хоть одна колонка отсутствует — падаем с её именем.
DO $$
DECLARE
  rec record;
  expected jsonb := '[
    {"t":"profiles","c":["id","full_name","role","is_active","created_at","updated_at"]},
    {"t":"projects","c":["id","name","description","created_by","created_at","updated_at"]},
    {"t":"project_memberships","c":["project_id","user_id","created_at"]},
    {"t":"work_types","c":["id","name","is_active","created_by","created_at"]},
    {"t":"work_assignments","c":["id","name","is_active","created_by","created_at"]},
    {"t":"performers","c":["id","name","kind","is_active","created_at"]},
    {"t":"plans","c":["id","project_id","name","r2_key","page_count","uploaded_by","created_at","floor","building","section","updated_at","storage"]},
    {"t":"reports","c":["id","project_id","work_type_id","performer_id","plan_id","author_id","description","taken_at","created_at","updated_at","work_assignment_id"]},
    {"t":"report_plan_marks","c":["id","report_id","plan_id","page","x_norm","y_norm","created_at"]},
    {"t":"report_photos","c":["id","report_id","r2_key","thumb_r2_key","width","height","taken_at","created_at","storage"]}
  ]'::jsonb;
  tbl text;
  col text;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(expected) AS e(item) LOOP
    tbl := rec.item->>'t';
    FOR col IN SELECT jsonb_array_elements_text(rec.item->'c') LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl AND column_name = col
      ) THEN
        RAISE EXCEPTION 'public.%.% not found', tbl, col;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

\echo 'OK: schema preconditions passed'
\echo

\echo '== source counts =='
SELECT 'auth.users (live, with profile)' AS source, count(*) AS rows
  FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.deleted_at IS NULL
UNION ALL SELECT 'public.profiles',            count(*) FROM public.profiles
UNION ALL SELECT 'public.projects',            count(*) FROM public.projects
UNION ALL SELECT 'public.project_memberships', count(*) FROM public.project_memberships
UNION ALL SELECT 'public.work_types',          count(*) FROM public.work_types
UNION ALL SELECT 'public.work_assignments',    count(*) FROM public.work_assignments
UNION ALL SELECT 'public.performers',          count(*) FROM public.performers
UNION ALL SELECT 'public.plans',               count(*) FROM public.plans
UNION ALL SELECT 'public.reports',             count(*) FROM public.reports
UNION ALL SELECT 'public.report_plan_marks',   count(*) FROM public.report_plan_marks
UNION ALL SELECT 'public.report_photos',       count(*) FROM public.report_photos;

\echo
\echo '== auth.users dropped from export (no profile or deleted) =='
SELECT
  count(*) FILTER (WHERE u.deleted_at IS NOT NULL)        AS soft_deleted,
  count(*) FILTER (WHERE p.id IS NULL)                    AS without_profile,
  count(*) FILTER (WHERE u.deleted_at IS NULL AND p.id IS NULL) AS without_profile_live
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id;

\echo
\echo '== password format breakdown (only live users with profile) =='
SELECT
  count(*) FILTER (WHERE u.encrypted_password ~ '^\$2[aby]\$')                                     AS bcrypt_format,
  count(*) FILTER (WHERE u.encrypted_password IS NULL)                                             AS null_password,
  count(*) FILTER (WHERE u.encrypted_password IS NOT NULL AND u.encrypted_password !~ '^\$2[aby]\$') AS other_format,
  count(*)                                                                                         AS total_export
FROM auth.users u JOIN public.profiles p ON p.id = u.id
WHERE u.deleted_at IS NULL;

\echo
\echo '== source-side orphans (would FK-fail on import if not filtered) =='

-- projects.created_by → profiles.id
SELECT 'projects.created_by → profiles.id' AS link, count(*) AS orphans
FROM public.projects pr
WHERE pr.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = pr.created_by);

-- work_types.created_by → profiles.id
SELECT 'work_types.created_by → profiles.id' AS link, count(*) AS orphans
FROM public.work_types wt
WHERE wt.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = wt.created_by);

-- work_assignments.created_by → profiles.id
SELECT 'work_assignments.created_by → profiles.id' AS link, count(*) AS orphans
FROM public.work_assignments wa
WHERE wa.created_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = wa.created_by);

-- plans.project_id → projects.id
SELECT 'plans.project_id → projects.id' AS link, count(*) AS orphans
FROM public.plans pl
WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = pl.project_id);

-- plans.uploaded_by → profiles.id
SELECT 'plans.uploaded_by → profiles.id' AS link, count(*) AS orphans
FROM public.plans pl
WHERE pl.uploaded_by IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = pl.uploaded_by);

-- reports.author_id → profiles.id
SELECT 'reports.author_id → profiles.id' AS link, count(*) AS orphans
FROM public.reports r
WHERE NOT EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = r.author_id);

-- reports.project_id → projects.id
SELECT 'reports.project_id → projects.id' AS link, count(*) AS orphans
FROM public.reports r
WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = r.project_id);

-- reports.work_type_id → work_types.id
SELECT 'reports.work_type_id → work_types.id' AS link, count(*) AS orphans
FROM public.reports r
WHERE NOT EXISTS (SELECT 1 FROM public.work_types wt WHERE wt.id = r.work_type_id);

-- reports.performer_id → performers.id
SELECT 'reports.performer_id → performers.id' AS link, count(*) AS orphans
FROM public.reports r
WHERE NOT EXISTS (SELECT 1 FROM public.performers p WHERE p.id = r.performer_id);

-- reports.plan_id (опционально) → plans.id
SELECT 'reports.plan_id → plans.id' AS link, count(*) AS orphans
FROM public.reports r
WHERE r.plan_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.plans pl WHERE pl.id = r.plan_id);

-- reports.work_assignment_id (опционально) → work_assignments.id
SELECT 'reports.work_assignment_id → work_assignments.id' AS link, count(*) AS orphans
FROM public.reports r
WHERE r.work_assignment_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.work_assignments wa WHERE wa.id = r.work_assignment_id);

-- report_photos.report_id → reports.id
SELECT 'report_photos.report_id → reports.id' AS link, count(*) AS orphans
FROM public.report_photos rp
WHERE NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.id = rp.report_id);

-- report_plan_marks.report_id → reports.id
SELECT 'report_plan_marks.report_id → reports.id' AS link, count(*) AS orphans
FROM public.report_plan_marks m
WHERE NOT EXISTS (SELECT 1 FROM public.reports r WHERE r.id = m.report_id);

-- report_plan_marks.plan_id → plans.id
SELECT 'report_plan_marks.plan_id → plans.id' AS link, count(*) AS orphans
FROM public.report_plan_marks m
WHERE NOT EXISTS (SELECT 1 FROM public.plans pl WHERE pl.id = m.plan_id);

-- project_memberships.project_id → projects.id
SELECT 'project_memberships.project_id → projects.id' AS link, count(*) AS orphans
FROM public.project_memberships pm
WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = pm.project_id);

-- project_memberships.user_id → profiles.id
SELECT 'project_memberships.user_id → profiles.id' AS link, count(*) AS orphans
FROM public.project_memberships pm
WHERE NOT EXISTS (SELECT 1 FROM public.profiles pf WHERE pf.id = pm.user_id);

\echo
\echo '== invalid storage values (must be cloudru or r2) =='
SELECT 'report_photos' AS tbl, count(*) AS bad_storage
  FROM public.report_photos WHERE storage NOT IN ('cloudru','r2')
UNION ALL
SELECT 'plans',                  count(*)
  FROM public.plans         WHERE storage NOT IN ('cloudru','r2');

\echo
\echo '== validate-source: done =='
