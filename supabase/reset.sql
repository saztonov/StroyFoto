-- =====================================================================
-- СтройФото — полная очистка Supabase.
-- Динамически находит и удаляет ВСЕ объекты в public schema,
-- а также очищает auth-данные.
--
-- ⚠️  НЕОБРАТИМАЯ ОПЕРАЦИЯ! Запускать только в SQL Editor Supabase.
-- ⚠️  После выполнения БД вернётся в «чистое» состояние.
-- ⚠️  Для повторной инициализации запустите schema.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Триггер на auth.users
-- ---------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;

-- ---------------------------------------------------------------------
-- 2. Удаление ВСЕХ таблиц в public schema
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select tablename from pg_tables where schemaname = 'public'
  ) loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Удаление ВСЕХ views в public schema
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select viewname from pg_views where schemaname = 'public'
  ) loop
    execute format('drop view if exists public.%I cascade', r.viewname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Удаление ВСЕХ функций в public schema
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select p.oid::regprocedure as func_sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')  -- functions and procedures
  ) loop
    begin
      execute format('drop function if exists %s cascade', r.func_sig);
    exception when others then
      execute format('drop routine if exists %s cascade', r.func_sig);
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Удаление ВСЕХ пользовательских типов в public schema
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype = 'e'  -- enum types
  ) loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Удаление ВСЕХ sequences в public schema
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in (
    select sequencename from pg_sequences where schemaname = 'public'
  ) loop
    execute format('drop sequence if exists public.%I cascade', r.sequencename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Очистка auth-данных
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'auth.mfa_challenges',
    'auth.mfa_factors',
    'auth.mfa_amr_claims',
    'auth.sessions',
    'auth.refresh_tokens',
    'auth.sso_sessions',
    'auth.sso_providers',
    'auth.sso_domains',
    'auth.saml_providers',
    'auth.saml_relay_states',
    'auth.flow_state',
    'auth.one_time_tokens',
    'auth.identities',
    'auth.users'
  ]
  loop
    begin
      execute format('delete from %s', t);
    exception when undefined_table then
      null;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Расширения (pgcrypto оставлен — используется Supabase внутренне)
-- ---------------------------------------------------------------------
drop extension if exists "citext";

-- ---------------------------------------------------------------------
-- 9. Storage (обходим защитный триггер Supabase)
-- ---------------------------------------------------------------------
do $$
begin
  alter table storage.objects disable trigger protect_delete;
  delete from storage.objects;
  alter table storage.objects enable trigger protect_delete;

  alter table storage.buckets disable trigger protect_delete;
  delete from storage.buckets;
  alter table storage.buckets enable trigger protect_delete;
exception
  when undefined_table then null;
  when undefined_object then null;
end;
$$;

-- =====================================================================
-- Готово. Для повторной инициализации запустите schema.sql.
-- =====================================================================
