-- Migration: Switch to Supabase Auth + add user-project access control
-- This migration:
-- 1. Renames public.users → public.profiles, removes password, adds auth_id
-- 2. Drops refresh_tokens (managed by Supabase Auth now)
-- 3. Creates user_projects junction table
-- 4. Adds trigger to auto-create profile on auth.users insert
-- 5. Renames username column to email in profiles

-- ============================================================
-- 1. Rename users → profiles, adapt columns
-- ============================================================

ALTER TABLE public.users RENAME TO profiles;

-- Remove password column (Supabase Auth manages passwords)
ALTER TABLE public.profiles DROP COLUMN password;

-- Rename username → email
ALTER TABLE public.profiles RENAME COLUMN username TO email;
ALTER TABLE public.profiles RENAME CONSTRAINT users_username_key TO profiles_email_key;
ALTER TABLE public.profiles RENAME CONSTRAINT users_pkey TO profiles_pkey;

-- Add auth_id column to link with auth.users
ALTER TABLE public.profiles ADD COLUMN auth_id uuid UNIQUE;

-- Rename the updated_at trigger
ALTER TRIGGER set_updated_at_users ON public.profiles RENAME TO set_updated_at_profiles;

-- ============================================================
-- 2. Drop refresh_tokens (Supabase Auth handles refresh tokens)
-- ============================================================

DROP TABLE IF EXISTS public.refresh_tokens;

-- ============================================================
-- 3. Create user_projects junction table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_projects (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_projects_pkey PRIMARY KEY (id),
    CONSTRAINT user_projects_user_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT user_projects_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
    CONSTRAINT user_projects_unique UNIQUE (user_id, project_id)
);

CREATE INDEX idx_user_projects_user_id ON public.user_projects(user_id);
CREATE INDEX idx_user_projects_project_id ON public.user_projects(project_id);

-- ============================================================
-- 4. Trigger: auto-create profile when a new auth.users row is inserted
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
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
