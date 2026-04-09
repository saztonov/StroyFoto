-- PDF-планы (чертежи) по проектам.

create table if not exists public.plans (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  r2_key       text not null,
  page_count   int  check (page_count is null or page_count > 0),
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists plans_project_idx on public.plans (project_id);
