-- ==========================================================================
-- Миграция: Realtime-публикации + батчевый RPC get_author_names
-- Дата: 2026-04-12
-- Контекст: Многопользовательская синхронизация и оптимизация N+1 RPC
-- ==========================================================================
--
-- Что делает:
--   1. Добавляет таблицы в supabase_realtime publication, чтобы Supabase
--      Realtime мог рассылать postgres_changes по WebSocket. RLS фильтрует
--      события автоматически — пользователи получат только строки, к которым
--      имеют SELECT-доступ.
--   2. Создаёт функцию get_author_names(uuid[]) — батчевую версию
--      get_author_name(uuid). Убирает N параллельных RPC при загрузке
--      списка отчётов.
--
-- Как применять:
--   Выполнить через Supabase Dashboard → SQL Editor или через CLI:
--     supabase db push --file supabase/migrations/20260412_realtime_and_batch_rpc.sql
--
-- Безопасность:
--   - ALTER PUBLICATION — idempotent (повторное добавление уже существующей
--     таблицы не вызывает ошибку в Supabase, но в vanilla Postgres даёт
--     ошибку; при необходимости оберните в DO-блок, см. ниже).
--   - CREATE OR REPLACE FUNCTION — безопасно перезаписывает функцию.
--   - REVOKE/GRANT — гарантируют минимальный доступ.
-- ==========================================================================

-- -----------------------------------------------------------------------
-- 1. Supabase Realtime: добавляем таблицы в публикацию
-- -----------------------------------------------------------------------
-- Если таблица уже в публикации, Supabase Dashboard игнорирует повтор.
-- Для vanilla Postgres раскомментируйте DO-блок ниже вместо прямых ALTER.

alter publication supabase_realtime add table public.reports;
alter publication supabase_realtime add table public.report_photos;
alter publication supabase_realtime add table public.report_plan_marks;
alter publication supabase_realtime add table public.plans;
alter publication supabase_realtime add table public.work_types;
alter publication supabase_realtime add table public.performers;
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.project_memberships;

-- Альтернатива для vanilla Postgres (idempotent):
-- DO $$
-- DECLARE
--   tbl text;
-- BEGIN
--   FOR tbl IN SELECT unnest(ARRAY[
--     'public.reports',
--     'public.report_photos',
--     'public.report_plan_marks',
--     'public.plans',
--     'public.work_types',
--     'public.performers',
--     'public.projects',
--     'public.project_memberships'
--   ])
--   LOOP
--     IF NOT EXISTS (
--       SELECT 1 FROM pg_publication_tables
--       WHERE pubname = 'supabase_realtime' AND schemaname || '.' || tablename = tbl
--     ) THEN
--       EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s', tbl);
--     END IF;
--   END LOOP;
-- END $$;

-- -----------------------------------------------------------------------
-- 2. Батчевый RPC: get_author_names(uuid[])
-- -----------------------------------------------------------------------
-- Принимает массив author_id, возвращает таблицу (author_id, full_name).
-- Повторяет логику доступа из get_author_name(uuid): ФИО доступно только
-- администратору или активному участнику проекта, в котором автор имеет
-- хотя бы один отчёт.
-- -----------------------------------------------------------------------

create or replace function public.get_author_names(p_author_ids uuid[])
returns table(author_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.id = any(p_author_ids)
    and (
      public.is_admin()
      or (
        public.is_active_user()
        and exists (
          select 1
          from public.reports r
          join public.project_memberships m
            on m.project_id = r.project_id and m.user_id = auth.uid()
          where r.author_id = p.id
        )
      )
    );
$$;

revoke all on function public.get_author_names(uuid[]) from public;
grant execute on function public.get_author_names(uuid[]) to authenticated;
