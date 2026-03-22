-- =============================================================================
-- СтройФото: Application Schema Reset & Rebuild
-- =============================================================================
-- This script drops and recreates ONLY the custom application objects in the
-- public schema. It does NOT touch Supabase-managed schemas (auth, storage,
-- realtime, vault, extensions) or their internal objects.
--
-- Safe to run on an empty database or to fully reset during development.
-- =============================================================================

BEGIN;

-- ============================================================================
-- 1. FULL CLEANUP — drop ALL custom objects in the public schema
-- ============================================================================
-- Uses dynamic SQL to find and drop everything automatically, so the cleanup
-- remains correct even if table/function names change in the future.
-- Supabase-managed schemas (auth, storage, realtime, vault, extensions) are
-- NOT touched.

-- 1a. Drop application triggers on auth.users (these reference public functions)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;

-- 1b. Drop ALL triggers on ALL public tables
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I',
                       r.trigger_name, r.event_object_table);
    END LOOP;
END;
$$;

-- 1c. Drop ALL views in public schema
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT table_name
        FROM information_schema.views
        WHERE table_schema = 'public'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.table_name);
    END LOOP;
END;
$$;

-- 1d. Drop ALL functions in public schema
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS func_signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind IN ('f', 'p')  -- functions and procedures
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.func_signature);
    END LOOP;
END;
$$;

-- 1e. Drop ALL tables in public schema (CASCADE removes indexes, constraints, etc.)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;
END;
$$;

-- 1f. Drop ALL custom enum types in public schema
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype = 'e'  -- enum types only
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END;
$$;


-- ============================================================================
-- 2. ENUM TYPES
-- ============================================================================

CREATE TYPE public.user_role AS ENUM ('ADMIN', 'WORKER');
CREATE TYPE public.sync_status AS ENUM ('PENDING', 'SYNCED', 'CONFLICT');
CREATE TYPE public.upload_status AS ENUM ('PENDING_UPLOAD', 'UPLOADED');


-- ============================================================================
-- 3. TABLES (in FK-dependency order)
-- ============================================================================

-- 3a. profiles ---------------------------------------------------------------
CREATE TABLE public.profiles (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    auth_id    uuid        UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    email      text        NOT NULL,
    role       user_role   NOT NULL DEFAULT 'WORKER',
    full_name  text        NOT NULL,
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_email_key UNIQUE (email)
);

-- 3b. projects ---------------------------------------------------------------
CREATE TABLE public.projects (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (btrim(name) <> ''),
    code       text        NOT NULL CHECK (btrim(code) <> ''),
    address    text        NOT NULL DEFAULT '',
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT projects_pkey PRIMARY KEY (id),
    CONSTRAINT projects_code_key UNIQUE (code)
);

-- 3c. user_projects (many-to-many) -------------------------------------------
CREATE TABLE public.user_projects (
    user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    project_id uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT user_projects_pkey PRIMARY KEY (user_id, project_id)
);

-- 3d. work_types (dictionary) ------------------------------------------------
CREATE TABLE public.work_types (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (btrim(name) <> ''),
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT work_types_pkey PRIMARY KEY (id)
);

-- 3e. contractors (dictionary) ------------------------------------------------
CREATE TABLE public.contractors (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (btrim(name) <> ''),
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT contractors_pkey PRIMARY KEY (id)
);

-- 3f. own_forces (dictionary) -------------------------------------------------
CREATE TABLE public.own_forces (
    id         uuid        NOT NULL DEFAULT gen_random_uuid(),
    name       text        NOT NULL CHECK (btrim(name) <> ''),
    is_active  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT own_forces_pkey PRIMARY KEY (id)
);

-- 3g. dictionary_aliases ------------------------------------------------------
CREATE TABLE public.dictionary_aliases (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    dictionary_type text        NOT NULL,
    item_id         uuid        NOT NULL,
    alias_name      text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dictionary_aliases_pkey PRIMARY KEY (id),
    CONSTRAINT uq_alias_type_name UNIQUE (dictionary_type, alias_name)
);

-- 3h. reports -----------------------------------------------------------------
CREATE TABLE public.reports (
    id          uuid          NOT NULL DEFAULT gen_random_uuid(),
    client_id   uuid          NOT NULL,
    project_id  uuid          NOT NULL REFERENCES public.projects(id),
    date_time   timestamptz   NOT NULL,
    work_types  text[]        NOT NULL DEFAULT '{}',
    contractor  text          NOT NULL,
    own_forces  text          NOT NULL DEFAULT '',
    description text          NOT NULL DEFAULT '',
    user_id     uuid          REFERENCES public.profiles(id) ON DELETE SET NULL,
    sync_status sync_status   NOT NULL DEFAULT 'SYNCED',
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT reports_pkey PRIMARY KEY (id),
    CONSTRAINT reports_client_id_key UNIQUE (client_id),
    CONSTRAINT reports_work_types_not_empty
        CHECK (cardinality(work_types) > 0),
    CONSTRAINT reports_work_types_no_blanks
        CHECK (array_position(work_types, '') IS NULL)
);

-- 3i. photos ------------------------------------------------------------------
CREATE TABLE public.photos (
    id            uuid          NOT NULL DEFAULT gen_random_uuid(),
    client_id     uuid          NOT NULL,
    report_id     uuid          NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    bucket        text          NOT NULL DEFAULT 'stroyfoto',
    object_key    text          NOT NULL,
    mime_type     text          NOT NULL,
    size_bytes    integer       NOT NULL,
    upload_status upload_status NOT NULL DEFAULT 'PENDING_UPLOAD',
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT photos_pkey PRIMARY KEY (id),
    CONSTRAINT photos_client_id_key UNIQUE (client_id)
);


-- ============================================================================
-- 4. VIEW
-- ============================================================================

CREATE OR REPLACE VIEW public.reports_with_photo_count AS
SELECT
    r.id,
    r.client_id,
    r.project_id,
    r.date_time,
    r.work_types,
    r.contractor,
    r.own_forces,
    r.description,
    r.user_id,
    r.sync_status,
    r.created_at,
    r.updated_at,
    (SELECT count(*) FROM public.photos p WHERE p.report_id = r.id) AS photo_count
FROM public.reports r;


-- ============================================================================
-- 5. FUNCTIONS
-- ============================================================================

-- 5a. update_updated_at_column ------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- 5b. handle_new_user ---------------------------------------------------------
-- Fired AFTER INSERT on auth.users.
-- Creates a profile row or re-links an existing one (matching by email).
-- Does NOT overwrite the role of an existing profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (auth_id, email, role, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        'WORKER',
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
    )
    ON CONFLICT (email) DO UPDATE SET
        auth_id    = EXCLUDED.auth_id,
        full_name  = EXCLUDED.full_name,
        is_active  = true,
        updated_at = now();
    -- Note: role is intentionally NOT included in the UPDATE to preserve
    -- the existing role (e.g. ADMIN) when an auth user is re-created.
    RETURN NEW;
END;
$$;

-- 5c. handle_user_deleted -----------------------------------------------------
-- Fired AFTER DELETE on auth.users.
-- Soft-deletes the profile: clears auth_id, deactivates, preserves history.
CREATE OR REPLACE FUNCTION public.handle_user_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.profiles
    SET auth_id    = NULL,
        is_active  = false,
        updated_at = now()
    WHERE auth_id = OLD.id;
    RETURN OLD;
END;
$$;

-- 5d. rename_dictionary_item --------------------------------------------------
-- Atomically renames a dictionary entry, saves the old name as an alias,
-- and cascade-updates all reports referencing the old name.
CREATE OR REPLACE FUNCTION public.rename_dictionary_item(
    p_dict_type  text,
    p_table_name text,
    p_item_id    uuid,
    p_new_name   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_name    text;
    v_conflict_id uuid;
BEGIN
    -- Whitelist allowed tables to prevent SQL injection via p_table_name
    IF p_table_name NOT IN ('work_types', 'contractors', 'own_forces') THEN
        RAISE EXCEPTION 'Invalid table name: %', p_table_name
            USING ERRCODE = '22023'; -- invalid_parameter_value
    END IF;

    -- Get current name
    EXECUTE format('SELECT name FROM public.%I WHERE id = $1', p_table_name)
        INTO v_old_name USING p_item_id;

    IF v_old_name IS NULL THEN
        RAISE EXCEPTION 'Item not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_old_name = p_new_name THEN
        RETURN;
    END IF;

    -- Check conflict with canonical name (case-insensitive)
    EXECUTE format(
        'SELECT id FROM public.%I WHERE lower(name) = lower($1) AND id != $2',
        p_table_name
    ) INTO v_conflict_id USING p_new_name, p_item_id;

    IF v_conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'Name already exists' USING ERRCODE = '23505';
    END IF;

    -- Check conflict with existing alias
    SELECT id INTO v_conflict_id
    FROM public.dictionary_aliases
    WHERE dictionary_type = p_dict_type
      AND lower(alias_name) = lower(p_new_name);

    IF v_conflict_id IS NOT NULL THEN
        RAISE EXCEPTION 'Name conflicts with existing alias' USING ERRCODE = '23505';
    END IF;

    -- Save old name as alias
    INSERT INTO public.dictionary_aliases (dictionary_type, item_id, alias_name)
    VALUES (p_dict_type, p_item_id, v_old_name)
    ON CONFLICT (dictionary_type, alias_name) DO NOTHING;

    -- Update canonical name
    EXECUTE format(
        'UPDATE public.%I SET name = $1, updated_at = now() WHERE id = $2',
        p_table_name
    ) USING p_new_name, p_item_id;

    -- Cascade update reports
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

-- 5e. reports_count_by_project ------------------------------------------------
-- Returns the number of reports per project. Used by /api/admin/stats.
CREATE OR REPLACE FUNCTION public.reports_count_by_project()
RETURNS TABLE(project_id uuid, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT r.project_id, count(*) AS count
    FROM public.reports r
    GROUP BY r.project_id;
$$;


-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

-- 6a. updated_at triggers on application tables
CREATE TRIGGER set_updated_at_profiles
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_updated_at_projects
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_updated_at_work_types
    BEFORE UPDATE ON public.work_types
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_updated_at_contractors
    BEFORE UPDATE ON public.contractors
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_updated_at_own_forces
    BEFORE UPDATE ON public.own_forces
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_updated_at_reports
    BEFORE UPDATE ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_updated_at_photos
    BEFORE UPDATE ON public.photos
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6b. Auth triggers (on Supabase-managed auth.users)
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_deleted
    AFTER DELETE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_user_deleted();


-- ============================================================================
-- 7. INDEXES
-- ============================================================================

-- photos
CREATE INDEX idx_photos_report_id ON public.photos USING btree (report_id);
CREATE INDEX idx_photos_report_upload_status ON public.photos USING btree (report_id, upload_status);

-- reports
CREATE INDEX idx_reports_project_id ON public.reports USING btree (project_id);
CREATE INDEX idx_reports_user_id ON public.reports USING btree (user_id);
CREATE INDEX idx_reports_date_time ON public.reports USING btree (date_time);
CREATE INDEX idx_reports_updated_at ON public.reports USING btree (updated_at);
CREATE INDEX idx_reports_project_sync_updated ON public.reports USING btree (project_id, sync_status, updated_at);
CREATE INDEX idx_reports_contractor ON public.reports USING btree (contractor);
CREATE INDEX idx_reports_own_forces ON public.reports USING btree (own_forces);
CREATE INDEX idx_reports_work_types ON public.reports USING gin (work_types);

-- user_projects
CREATE INDEX idx_user_projects_project_id ON public.user_projects USING btree (project_id);

-- dictionary_aliases
CREATE INDEX idx_dict_aliases_item_id ON public.dictionary_aliases USING btree (item_id);
CREATE INDEX idx_dict_aliases_type_name ON public.dictionary_aliases USING btree (dictionary_type, lower(alias_name));

-- Case-insensitive uniqueness for dictionaries
CREATE UNIQUE INDEX uq_work_types_name_ci ON public.work_types (lower(name));
CREATE UNIQUE INDEX uq_contractors_name_ci ON public.contractors (lower(name));
CREATE UNIQUE INDEX uq_own_forces_name_ci ON public.own_forces (lower(name));


-- ============================================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================================
-- RLS is enabled for defense-in-depth. No policies are created because all
-- application queries go through the API backend using the service_role key,
-- which bypasses RLS. This ensures that direct access via anon/authenticated
-- keys cannot read or modify application data.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.own_forces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dictionary_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

COMMIT;
