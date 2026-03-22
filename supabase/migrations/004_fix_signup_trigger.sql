-- Migration: Fix signup trigger + add cleanup on user deletion
--
-- Problem 1: When a user is deleted from auth.users (via Supabase dashboard),
--   the profile row in public.profiles remains. Re-registering with the same
--   email hits "duplicate key value violates unique constraint profiles_email_key"
--   → Supabase Auth returns 500.
--
-- Problem 2: No cleanup of orphaned profiles when auth users are deleted.
--
-- Fix: make the trigger idempotent with ON CONFLICT, and add a DELETE trigger.

-- ============================================================
-- 1. Fix handle_new_user: upsert instead of plain insert
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (auth_id, email, role, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    'WORKER',
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (email) DO UPDATE SET
    auth_id = EXCLUDED.auth_id,
    full_name = EXCLUDED.full_name,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Add trigger to clean up profile when auth user is deleted
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_user_deleted()
RETURNS trigger AS $$
BEGIN
  DELETE FROM public.profiles WHERE auth_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_deleted
  AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_deleted();

-- ============================================================
-- 3. Clean up existing orphaned profiles (no matching auth user)
-- ============================================================

DELETE FROM public.profiles
WHERE auth_id IS NOT NULL
  AND auth_id NOT IN (SELECT id FROM auth.users);
