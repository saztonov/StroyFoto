-- Profiles + общие хелперы (триггер updated_at, is_admin, is_active_user, handle_new_user).

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        public.user_role not null default 'user',
  is_active   boolean          not null default false,
  created_at  timestamptz      not null default now(),
  updated_at  timestamptz      not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- Общий триггер updated_at — будет переиспользоваться остальными таблицами.
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

-- Авто-создание profile при регистрации пользователя в auth.users.
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

-- Хелперы для RLS. SECURITY DEFINER, чтобы избежать рекурсии при чтении profiles из политик.
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
