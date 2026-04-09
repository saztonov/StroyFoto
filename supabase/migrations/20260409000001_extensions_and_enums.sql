-- Расширения и enum-типы для MVP "СтройФото".

create extension if not exists "pgcrypto";
create extension if not exists "citext";

do $$ begin
  create type public.user_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.performer_kind as enum ('contractor', 'own_forces');
exception when duplicate_object then null; end $$;
