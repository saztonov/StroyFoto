-- Migration: Remove mark/area fields, add work_types array, add own_forces table
-- Date: 2026-03-22

-- 1. Create own_forces reference table
CREATE TABLE IF NOT EXISTS public.own_forces (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT own_forces_pkey PRIMARY KEY (id),
    CONSTRAINT own_forces_name_key UNIQUE (name)
);

-- 2. Add work_types array column to reports
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS work_types text[] NOT NULL DEFAULT '{}';

-- 3. Migrate existing work_type data to work_types array
UPDATE public.reports
SET work_types = ARRAY[work_type]
WHERE work_type IS NOT NULL AND work_type != '' AND work_types = '{}';

-- 4. Add own_forces column to reports
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS own_forces text NOT NULL DEFAULT '';

-- 5. Make deprecated columns nullable (backward compat, drop in next release)
ALTER TABLE public.reports ALTER COLUMN mark DROP NOT NULL;
ALTER TABLE public.reports ALTER COLUMN mark SET DEFAULT '';

ALTER TABLE public.reports ALTER COLUMN area DROP NOT NULL;
ALTER TABLE public.reports ALTER COLUMN area SET DEFAULT '';

ALTER TABLE public.reports ALTER COLUMN work_type DROP NOT NULL;
ALTER TABLE public.reports ALTER COLUMN work_type SET DEFAULT '';
