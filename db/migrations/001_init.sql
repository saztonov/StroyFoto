-- 001_init.sql
-- Инициализация схемы StroyFoto для Yandex Managed PostgreSQL.
-- Права доступа реализуются на уровне backend (middleware/service), RLS не используется.

BEGIN;

-- ============================================================================
-- Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- регистронезависимый text для name-полей

-- ============================================================================
-- Enum types
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'user');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'performer_kind') THEN
    CREATE TYPE performer_kind AS ENUM ('contractor', 'own_forces');
  END IF;
END
$$;

-- ============================================================================
-- Trigger function: автоматически обновляет updated_at при UPDATE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- app_users: учётная запись (login + password).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_users (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext      NOT NULL UNIQUE,
  password_hash         text        NULL,
  password_must_reset   boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz NULL,
  deleted_at            timestamptz NULL
);

CREATE TRIGGER set_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- profiles: доменный профиль (роль, активация, ФИО). 1:1 с app_users.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid        PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  full_name   text        NULL,
  role        user_role   NOT NULL DEFAULT 'user',
  is_active   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_role_idx
  ON public.profiles (role);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- projects: строительные объекты
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text        NULL,
  created_by  uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_name_lower_uniq
  ON public.projects (lower(name));

CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- project_memberships: назначение пользователей на проекты (M:N)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.project_memberships (
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_memberships_user_idx
  ON public.project_memberships (user_id);

-- ============================================================================
-- work_types: виды работ (citext, без учёта регистра)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.work_types (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext      NOT NULL UNIQUE,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- work_assignments: назначения работ (citext, без учёта регистра)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.work_assignments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext      NOT NULL UNIQUE,
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- performers: исполнители (подрядчики и собственные силы)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.performers (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext         NOT NULL,
  kind        performer_kind NOT NULL,
  is_active   boolean        NOT NULL DEFAULT true,
  created_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT performers_kind_name_key UNIQUE (kind, name)
);

-- ============================================================================
-- plans: PDF-планы по проектам. Бинари в Cloud.ru Object Storage (s3.cloud.ru).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  object_key  text        NOT NULL,
  page_count  integer     NULL,
  uploaded_by uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  floor       text        NULL,
  building    text        NULL,
  section     text        NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_page_count_check
    CHECK (page_count IS NULL OR page_count > 0)
);

CREATE INDEX IF NOT EXISTS plans_project_idx
  ON public.plans (project_id);

CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- reports: фотоотчёт (project + work_type + performer + plan + author).
-- id генерируется на клиенте (offline-first), поэтому без DEFAULT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reports (
  id                  uuid        PRIMARY KEY,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)         ON DELETE RESTRICT,
  work_type_id        uuid        NOT NULL REFERENCES public.work_types(id)       ON DELETE RESTRICT,
  performer_id        uuid        NOT NULL REFERENCES public.performers(id)       ON DELETE RESTRICT,
  plan_id             uuid        NULL     REFERENCES public.plans(id)            ON DELETE SET NULL,
  author_id           uuid        NOT NULL REFERENCES public.profiles(id)         ON DELETE RESTRICT,
  description         text        NULL,
  taken_at            timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  work_assignment_id  uuid        NULL     REFERENCES public.work_assignments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS reports_project_created_idx
  ON public.reports (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reports_author_idx
  ON public.reports (author_id);

CREATE TRIGGER set_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- report_plan_marks: точка на плане для отчёта (одна на отчёт — unique).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_plan_marks (
  id          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid           NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  plan_id     uuid           NOT NULL REFERENCES public.plans(id)   ON DELETE CASCADE,
  page        integer        NOT NULL,
  x_norm      numeric(7, 6)  NOT NULL,
  y_norm      numeric(7, 6)  NOT NULL,
  created_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT report_plan_marks_page_check
    CHECK (page > 0),
  CONSTRAINT report_plan_marks_x_norm_check
    CHECK (x_norm >= 0 AND x_norm <= 1),
  CONSTRAINT report_plan_marks_y_norm_check
    CHECK (y_norm >= 0 AND y_norm <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS report_plan_marks_report_uniq
  ON public.report_plan_marks (report_id);

CREATE INDEX IF NOT EXISTS report_plan_marks_plan_idx
  ON public.report_plan_marks (plan_id);

-- ============================================================================
-- report_photos: фото отчёта. id генерируется на клиенте (offline-first).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_photos (
  id                uuid        PRIMARY KEY,
  report_id         uuid        NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  object_key        text        NOT NULL,
  thumb_object_key  text        NULL,
  width             integer     NULL,
  height            integer     NULL,
  taken_at          timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_photos_width_check
    CHECK (width IS NULL OR width > 0),
  CONSTRAINT report_photos_height_check
    CHECK (height IS NULL OR height > 0)
);

CREATE INDEX IF NOT EXISTS report_photos_report_idx
  ON public.report_photos (report_id);

COMMIT;
