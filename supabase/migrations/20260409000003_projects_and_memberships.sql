-- Проекты и членство пользователей в проектах.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  description text,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists projects_name_lower_uniq on public.projects (lower(name));

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create table if not exists public.project_memberships (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_memberships_user_idx on public.project_memberships (user_id);
