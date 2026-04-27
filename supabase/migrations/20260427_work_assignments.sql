-- =====================================================================
-- Migration: work_assignments (Назначение работ)
-- Date: 2026-04-27
--
-- Adds new catalog table `work_assignments` (analogous to `work_types`),
-- a nullable FK column `reports.work_assignment_id`, RLS policies,
-- realtime publication, and replica identity for live updates.
-- =====================================================================

-- ----- 1. Catalog table ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.work_assignments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name citext NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT work_assignments_pkey PRIMARY KEY (id),
    CONSTRAINT work_assignments_name_key UNIQUE (name),
    CONSTRAINT work_assignments_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.profiles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS work_assignments_name_key
    ON public.work_assignments USING btree (name);

-- ----- 2. Reports column (nullable, no backfill) ---------------------------

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS work_assignment_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND constraint_name = 'reports_work_assignment_id_fkey'
    ) THEN
        ALTER TABLE public.reports
            ADD CONSTRAINT reports_work_assignment_id_fkey
            FOREIGN KEY (work_assignment_id) REFERENCES public.work_assignments(id);
    END IF;
END$$;

-- ----- 3. RLS policies (mirror work_types) ---------------------------------

ALTER TABLE public.work_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_assignments_select_active" ON public.work_assignments;
CREATE POLICY "work_assignments_select_active"
    ON public.work_assignments
    FOR SELECT
    TO authenticated
    USING (public.is_active_user());

DROP POLICY IF EXISTS "work_assignments_insert_active" ON public.work_assignments;
CREATE POLICY "work_assignments_insert_active"
    ON public.work_assignments
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_active_user());

DROP POLICY IF EXISTS "work_assignments_update_admin" ON public.work_assignments;
CREATE POLICY "work_assignments_update_admin"
    ON public.work_assignments
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "work_assignments_delete_admin" ON public.work_assignments;
CREATE POLICY "work_assignments_delete_admin"
    ON public.work_assignments
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- ----- 4. Realtime: REPLICA IDENTITY + publication -------------------------

ALTER TABLE public.work_assignments REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'work_assignments'
        ) THEN
            EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.work_assignments';
        END IF;
    END IF;
END$$;
