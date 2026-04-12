-- =====================================================================
-- СтройФото — единый SQL-скрипт для инициализации новой БД в Supabase.
-- Запускать целиком в Supabase SQL Editor на чистом проекте.
-- Объединяет миграции 20260409000001..20260409000007.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Расширения и enum-типы
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "citext";

do $$ begin
  create type public.user_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.performer_kind as enum ('contractor', 'own_forces');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Profiles + общие функции/триггеры
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        public.user_role not null default 'user',
  is_active   boolean          not null default false,
  created_at  timestamptz      not null default now(),
  updated_at  timestamptz      not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;

revoke all on function public.is_admin()        from public;
revoke all on function public.is_active_user()  from public;
grant execute on function public.is_admin()       to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Projects + memberships
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 4. Справочники: work_types и performers
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 5. PDF-планы
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  name         text not null,
  floor        text,
  building     text,
  section      text,
  r2_key       text not null,
  page_count   int  check (page_count is null or page_count > 0),
  uploaded_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists set_plans_updated_at on public.plans;
create trigger set_plans_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create index if not exists plans_project_idx on public.plans (project_id);

-- ---------------------------------------------------------------------
-- 6. Reports + plan marks + photos
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id            uuid primary key,  -- клиентский UUID для офлайн-идемпотентности
  project_id    uuid not null references public.projects(id)   on delete restrict,
  work_type_id  uuid not null references public.work_types(id) on delete restrict,
  performer_id  uuid not null references public.performers(id) on delete restrict,
  plan_id       uuid          references public.plans(id)      on delete set null,
  author_id     uuid not null references public.profiles(id)   on delete restrict,
  description   text,
  taken_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists reports_project_created_idx on public.reports (project_id, created_at desc);
create index if not exists reports_author_idx          on public.reports (author_id);

drop trigger if exists set_updated_at on public.reports;
create trigger set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

create table if not exists public.report_plan_marks (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  plan_id     uuid not null references public.plans(id)   on delete restrict,
  page        int  not null check (page > 0),
  x_norm      numeric(7,6) not null check (x_norm >= 0 and x_norm <= 1),
  y_norm      numeric(7,6) not null check (y_norm >= 0 and y_norm <= 1),
  created_at  timestamptz not null default now()
);

create unique index if not exists report_plan_marks_report_uniq on public.report_plan_marks (report_id);
create index if not exists report_plan_marks_plan_idx on public.report_plan_marks (plan_id);

create table if not exists public.report_photos (
  id            uuid primary key,  -- клиентский UUID
  report_id     uuid not null references public.reports(id) on delete cascade,
  r2_key        text not null,
  thumb_r2_key  text,
  width         int  check (width  is null or width  > 0),
  height        int  check (height is null or height > 0),
  taken_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists report_photos_report_idx on public.report_photos (report_id);

-- ---------------------------------------------------------------------
-- 7. RLS: включение и политики
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_memberships enable row level security;
alter table public.work_types          enable row level security;
alter table public.performers          enable row level security;
alter table public.plans               enable row level security;
alter table public.reports             enable row level security;
alter table public.report_plan_marks   enable row level security;
alter table public.report_photos       enable row level security;

-- profiles
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and is_active = (select is_active from public.profiles where id = auth.uid())
  );

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- projects
drop policy if exists projects_select_member_or_admin on public.projects;
create policy projects_select_member_or_admin on public.projects
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active_user()
      and exists (
        select 1 from public.project_memberships m
        where m.project_id = projects.id and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists projects_admin_all on public.projects;
create policy projects_admin_all on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- project_memberships
drop policy if exists memberships_select_self_or_admin on public.project_memberships;
create policy memberships_select_self_or_admin on public.project_memberships
  for select to authenticated
  using (
    public.is_admin()
    or (public.is_active_user() and user_id = auth.uid())
  );

drop policy if exists memberships_admin_all on public.project_memberships;
create policy memberships_admin_all on public.project_memberships
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- work_types
drop policy if exists work_types_select_active on public.work_types;
create policy work_types_select_active on public.work_types
  for select to authenticated
  using (public.is_active_user());

drop policy if exists work_types_insert_active on public.work_types;
create policy work_types_insert_active on public.work_types
  for insert to authenticated
  with check (public.is_active_user() and is_active = true);

drop policy if exists work_types_admin_all on public.work_types;
create policy work_types_admin_all on public.work_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- performers
drop policy if exists performers_select_active on public.performers;
create policy performers_select_active on public.performers
  for select to authenticated
  using (public.is_active_user());

drop policy if exists performers_admin_all on public.performers;
create policy performers_admin_all on public.performers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- plans
drop policy if exists plans_select_member_or_admin on public.plans;
create policy plans_select_member_or_admin on public.plans
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active_user()
      and exists (
        select 1 from public.project_memberships m
        where m.project_id = plans.project_id and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists plans_insert_member on public.plans;
create policy plans_insert_member on public.plans
  for insert to authenticated
  with check (
    public.is_active_user()
    and exists (
      select 1 from public.project_memberships m
      where m.project_id = plans.project_id and m.user_id = auth.uid()
    )
  );

drop policy if exists plans_update_member on public.plans;
create policy plans_update_member on public.plans
  for update to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.project_memberships m
      where m.project_id = plans.project_id and m.user_id = auth.uid()
    )
  )
  with check (
    public.is_active_user()
    and exists (
      select 1 from public.project_memberships m
      where m.project_id = plans.project_id and m.user_id = auth.uid()
    )
  );

drop policy if exists plans_delete_uploader on public.plans;
create policy plans_delete_uploader on public.plans
  for delete to authenticated
  using (
    public.is_active_user()
    and uploaded_by = auth.uid()
  );

drop policy if exists plans_admin_all on public.plans;
create policy plans_admin_all on public.plans
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- reports
drop policy if exists reports_select_member_or_admin on public.reports;
create policy reports_select_member_or_admin on public.reports
  for select to authenticated
  using (
    public.is_admin()
    or (
      public.is_active_user()
      and exists (
        select 1 from public.project_memberships m
        where m.project_id = reports.project_id and m.user_id = auth.uid()
      )
    )
  );

drop policy if exists reports_insert_member on public.reports;
create policy reports_insert_member on public.reports
  for insert to authenticated
  with check (
    public.is_active_user()
    and author_id = auth.uid()
    and exists (
      select 1 from public.project_memberships m
      where m.project_id = reports.project_id and m.user_id = auth.uid()
    )
    and (
      plan_id is null
      or exists (
        select 1 from public.plans p
        where p.id = reports.plan_id and p.project_id = reports.project_id
      )
    )
  );

drop policy if exists reports_update_author on public.reports;
create policy reports_update_author on public.reports
  for update to authenticated
  using (
    public.is_active_user()
    and author_id = auth.uid()
  )
  with check (
    public.is_active_user()
    and author_id = auth.uid()
  );

drop policy if exists reports_delete_author on public.reports;
create policy reports_delete_author on public.reports
  for delete to authenticated
  using (
    public.is_active_user()
    and author_id = auth.uid()
  );

drop policy if exists reports_admin_all on public.reports;
create policy reports_admin_all on public.reports
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- report_plan_marks
drop policy if exists report_marks_select on public.report_plan_marks;
create policy report_marks_select on public.report_plan_marks
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.reports r
      join public.project_memberships m on m.project_id = r.project_id
      where r.id = report_plan_marks.report_id and m.user_id = auth.uid()
    )
  );

drop policy if exists report_marks_insert on public.report_plan_marks;
create policy report_marks_insert on public.report_plan_marks
  for insert to authenticated
  with check (
    public.is_active_user()
    and exists (
      select 1
      from public.reports r
      join public.plans p on p.id = report_plan_marks.plan_id
      where r.id = report_plan_marks.report_id
        and r.author_id = auth.uid()
        and p.project_id = r.project_id
    )
  );

drop policy if exists report_marks_admin_all on public.report_plan_marks;
create policy report_marks_admin_all on public.report_plan_marks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- report_photos
drop policy if exists report_photos_select on public.report_photos;
create policy report_photos_select on public.report_photos
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.reports r
      join public.project_memberships m on m.project_id = r.project_id
      where r.id = report_photos.report_id and m.user_id = auth.uid()
    )
  );

drop policy if exists report_photos_insert on public.report_photos;
create policy report_photos_insert on public.report_photos
  for insert to authenticated
  with check (
    public.is_active_user()
    and exists (
      select 1 from public.reports r
      where r.id = report_photos.report_id and r.author_id = auth.uid()
    )
  );

drop policy if exists report_photos_admin_all on public.report_photos;
create policy report_photos_admin_all on public.report_photos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 8. Admin RPC: список профилей с email из auth.users
-- ---------------------------------------------------------------------
create or replace function public.admin_list_profiles()
returns table (
  id          uuid,
  full_name   text,
  email       text,
  role        public.user_role,
  is_active   boolean,
  created_at  timestamptz,
  updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, u.email::text, p.role, p.is_active, p.created_at, p.updated_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at desc;
$$;

revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;

-- ---------------------------------------------------------------------
-- 9. get_author_name: ФИО автора чужого отчёта без ослабления RLS.
--    Используется в UI карточек/деталей, когда активный участник проекта
--    видит чужие отчёты, но политика profiles_select_self_or_admin не
--    даёт прочитать profile автора напрямую. Функция возвращает только
--    full_name и только если вызывающий — admin или активный член того
--    же проекта, в котором запрашиваемый пользователь автор хотя бы
--    одного отчёта. Это минимальный compromise: не раскрываем ничего
--    кроме имени, и только тем, кто и так имеет право видеть отчёт.
-- ---------------------------------------------------------------------
create or replace function public.get_author_name(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name
  from public.profiles p
  where p.id = p_author_id
    and (
      public.is_admin()
      or (
        public.is_active_user()
        and exists (
          select 1
          from public.reports r
          join public.project_memberships m
            on m.project_id = r.project_id and m.user_id = auth.uid()
          where r.author_id = p_author_id
        )
      )
    );
$$;

revoke all on function public.get_author_name(uuid) from public;
grant execute on function public.get_author_name(uuid) to authenticated;

-- =====================================================================
-- Готово. После применения:
--   1) зарегистрируйтесь через UI;
--   2) выполните bootstrap первого админа:
--
--      update public.profiles
--      set role = 'admin', is_active = true
--      where id = (select id from auth.users where email = 'admin@example.com');
-- =====================================================================
