-- ============================================================
-- Migration 003: Offline-First Sync, project visibility, zero-cache
-- Date: 2026-03-22
-- ============================================================
--
-- Context:
--   This migration accompanies the client-side changes for:
--   1. Scoped data isolation (scopeProfileId) — client-side only (IndexedDB)
--   2. WORKER project-based visibility — API query changes, no schema changes
--   3. Zero-cache for photos — API Cache-Control header changes
--   4. FINALIZE_REPORT flow — uses existing /api/reports/:id/finalize endpoint
--
-- The server-side schema does NOT require structural changes for these features.
-- This script contains:
--   A) Verification queries to confirm schema health
--   B) Optional cleanup of deprecated columns (mark, work_type, area)
--   C) Performance index for project-based report queries
--   D) Data integrity checks
--
-- ============================================================

-- ============================================================
-- A) VERIFICATION: Confirm required columns/indexes exist
-- ============================================================

-- Verify reports table has work_types array column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'work_types'
  ) THEN
    RAISE EXCEPTION 'Column reports.work_types does not exist — migration cannot proceed';
  END IF;
END $$;

-- Verify reports table has own_forces column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'own_forces'
  ) THEN
    RAISE EXCEPTION 'Column reports.own_forces does not exist — migration cannot proceed';
  END IF;
END $$;

-- Verify user_projects table exists (required for project-based visibility)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_projects'
  ) THEN
    RAISE EXCEPTION 'Table user_projects does not exist — required for project-based WORKER visibility';
  END IF;
END $$;

-- ============================================================
-- B) OPTIONAL: Remove deprecated columns
--    These columns were replaced in Dexie v6 migration:
--      mark       → removed (not used)
--      work_type  → work_types[] array
--      area       → removed (not used)
--
--    IMPORTANT: Only run this section AFTER confirming no external
--    systems depend on these columns. The columns have DEFAULT ''
--    and are nullable, so they don't break inserts.
--
--    Uncomment the ALTER TABLE statements below when ready.
-- ============================================================

-- Migrate any remaining data from deprecated columns to new columns
-- (Safety: only update rows where work_types is empty but work_type has value)
UPDATE public.reports
SET work_types = ARRAY[work_type]
WHERE work_type IS NOT NULL
  AND work_type != ''
  AND (work_types IS NULL OR work_types = '{}');

-- Uncomment when ready to drop deprecated columns:
-- ALTER TABLE public.reports DROP COLUMN IF EXISTS mark;
-- ALTER TABLE public.reports DROP COLUMN IF EXISTS work_type;
-- ALTER TABLE public.reports DROP COLUMN IF EXISTS area;

-- ============================================================
-- C) PERFORMANCE: Add composite index for project-based queries
--    WORKER now sees all reports in assigned projects (not just own),
--    so queries filter by project_id + sync_status more often.
-- ============================================================

-- Composite index for sync/pull queries: project_id + sync_status + updated_at
CREATE INDEX IF NOT EXISTS idx_reports_project_sync_updated
  ON public.reports (project_id, sync_status, updated_at);

-- Index on photos for finalization check: report_id + upload_status
CREATE INDEX IF NOT EXISTS idx_photos_report_upload_status
  ON public.photos (report_id, upload_status);

-- ============================================================
-- D) DATA INTEGRITY: Verify no orphaned records
-- ============================================================

-- Check for photos referencing non-existent reports
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

-- Check for reports referencing non-existent projects
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

-- Check for user_projects referencing non-existent users
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

-- ============================================================
-- E) SUMMARY of what changed at API level (no SQL needed):
--
-- 1. GET /api/reports — WORKER filter changed:
--    OLD: .eq("user_id", profileId)
--    NEW: .in("project_id", accessibleProjectIds)
--    Worker now sees ALL reports in assigned projects, not just own.
--
-- 2. GET /api/sync/pull — Same change as above.
--
-- 3. GET /api/reports/:id — Access check changed:
--    OLD: report.user_id !== profileId → 403
--    NEW: report.project_id NOT IN accessibleProjectIds → 403
--
-- 4. GET /api/photos/:id — Added:
--    - Project access check via parent report
--    - Cache-Control: private, no-store (was max-age=3600)
--
-- 5. Client-side (IndexedDB/Dexie v8):
--    - Added scopeProfileId to all user-scoped tables
--    - UPSERT_REPORT no longer sets syncStatus=synced
--    - FINALIZE_REPORT sets syncStatus=synced + auto-cleans photo blobs
--    - Pull uses cursor-based /api/sync/pull (was /api/reports)
--    - Reference data: full-replace per scope (was incremental)
--    - SW: removed CacheFirst for /api/photos/* and /api/reference/*
--    - Detail page: memory-only photo loading (no write-back to IndexedDB)
-- ============================================================
