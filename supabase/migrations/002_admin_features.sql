-- Migration: Admin features
-- 1. Add is_active column to profiles
-- 2. RPC function for cascading work_type rename in reports
-- 3. Indexes for cascading updates

-- 1. profiles.is_active
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. RPC: rename work_type inside reports.work_types[] array
CREATE OR REPLACE FUNCTION public.rename_work_type_in_reports(
  old_name text,
  new_name text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.reports
  SET work_types = array_replace(work_types, old_name, new_name),
      updated_at = now()
  WHERE old_name = ANY(work_types);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

-- 3. Indexes for cascading rename performance
CREATE INDEX IF NOT EXISTS idx_reports_contractor ON public.reports (contractor);
CREATE INDEX IF NOT EXISTS idx_reports_own_forces ON public.reports (own_forces);
CREATE INDEX IF NOT EXISTS idx_reports_work_types ON public.reports USING GIN (work_types);
