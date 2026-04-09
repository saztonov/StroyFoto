-- Справочники: виды работ и исполнители (подрядчики / собственные силы).

create table if not exists public.work_types (
  id          uuid primary key default gen_random_uuid(),
  name        citext      not null unique,
  is_active   boolean     not null default true,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.performers (
  id          uuid primary key default gen_random_uuid(),
  name        citext      not null,
  kind        public.performer_kind not null,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  unique (kind, name)
);

create index if not exists performers_kind_idx on public.performers (kind);
