-- validate-target.sql
-- Пост-импортная проверка Yandex Managed PostgreSQL.
--
-- Запускается через:
--   psql "$YANDEX_DB_URL" -v ON_ERROR_STOP=1 -f validate-target.sql
--
-- Поведение:
--   * Counts по 11 таблицам — всегда печатаются.
--   * Orphan-проверки и проверки storage — RAISE EXCEPTION при найденных
--     нарушениях. Это даёт ненулевой exit code импорту, чтобы оператор
--     увидел: данные импортированы, но БД не валидна — cutover откладывать.

\echo '== target counts =='
SELECT 'app_users'           AS "table", count(*) FROM public.app_users
UNION ALL SELECT 'profiles',            count(*) FROM public.profiles
UNION ALL SELECT 'projects',            count(*) FROM public.projects
UNION ALL SELECT 'project_memberships', count(*) FROM public.project_memberships
UNION ALL SELECT 'work_types',          count(*) FROM public.work_types
UNION ALL SELECT 'work_assignments',    count(*) FROM public.work_assignments
UNION ALL SELECT 'performers',          count(*) FROM public.performers
UNION ALL SELECT 'plans',               count(*) FROM public.plans
UNION ALL SELECT 'reports',             count(*) FROM public.reports
UNION ALL SELECT 'report_plan_marks',   count(*) FROM public.report_plan_marks
UNION ALL SELECT 'report_photos',       count(*) FROM public.report_photos;

\echo
\echo '== orphan checks (fatal on failure) =='

DO $$
DECLARE n bigint;
BEGIN
  -- profiles без app_users
  SELECT count(*) INTO n FROM public.profiles p
    LEFT JOIN public.app_users u ON u.id = p.id WHERE u.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% profiles without matching app_users', n; END IF;

  -- project_memberships.user_id без app_users
  SELECT count(*) INTO n FROM public.project_memberships pm
    LEFT JOIN public.app_users u ON u.id = pm.user_id WHERE u.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% project_memberships.user_id without matching app_users', n; END IF;

  -- project_memberships.project_id без projects
  SELECT count(*) INTO n FROM public.project_memberships pm
    LEFT JOIN public.projects pr ON pr.id = pm.project_id WHERE pr.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% project_memberships.project_id without matching projects', n; END IF;

  -- reports.project_id без projects
  SELECT count(*) INTO n FROM public.reports r
    LEFT JOIN public.projects pr ON pr.id = r.project_id WHERE pr.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% reports.project_id without matching projects', n; END IF;

  -- reports.work_type_id без work_types
  SELECT count(*) INTO n FROM public.reports r
    LEFT JOIN public.work_types wt ON wt.id = r.work_type_id WHERE wt.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% reports.work_type_id without matching work_types', n; END IF;

  -- reports.performer_id без performers
  SELECT count(*) INTO n FROM public.reports r
    LEFT JOIN public.performers pe ON pe.id = r.performer_id WHERE pe.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% reports.performer_id without matching performers', n; END IF;

  -- reports.author_id без profiles
  SELECT count(*) INTO n FROM public.reports r
    LEFT JOIN public.profiles pf ON pf.id = r.author_id WHERE pf.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% reports.author_id without matching profiles', n; END IF;

  -- reports.author_id без app_users (через profiles)
  SELECT count(*) INTO n FROM public.reports r
    LEFT JOIN public.app_users u ON u.id = r.author_id WHERE u.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% reports.author_id without matching app_users', n; END IF;

  -- report_photos.report_id без reports
  SELECT count(*) INTO n FROM public.report_photos rp
    LEFT JOIN public.reports r ON r.id = rp.report_id WHERE r.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% report_photos.report_id without matching reports', n; END IF;

  -- report_plan_marks.report_id без reports
  SELECT count(*) INTO n FROM public.report_plan_marks m
    LEFT JOIN public.reports r ON r.id = m.report_id WHERE r.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% report_plan_marks.report_id without matching reports', n; END IF;

  -- report_plan_marks.plan_id без plans
  SELECT count(*) INTO n FROM public.report_plan_marks m
    LEFT JOIN public.plans pl ON pl.id = m.plan_id WHERE pl.id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% report_plan_marks.plan_id without matching plans', n; END IF;

  RAISE NOTICE 'orphan checks: OK';
END
$$;

\echo
\echo '== storage values check (fatal on failure) =='

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.report_photos WHERE storage NOT IN ('cloudru','r2');
  IF n > 0 THEN RAISE EXCEPTION '% report_photos.storage NOT IN (cloudru, r2)', n; END IF;

  SELECT count(*) INTO n FROM public.plans WHERE storage NOT IN ('cloudru','r2');
  IF n > 0 THEN RAISE EXCEPTION '% plans.storage NOT IN (cloudru, r2)', n; END IF;

  RAISE NOTICE 'storage checks: OK';
END
$$;

\echo
\echo '== validate-target: done =='
