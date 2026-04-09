-- Включение RLS и политики доступа.

alter table public.profiles            enable row level security;
alter table public.projects            enable row level security;
alter table public.project_memberships enable row level security;
alter table public.work_types          enable row level security;
alter table public.performers          enable row level security;
alter table public.plans               enable row level security;
alter table public.reports             enable row level security;
alter table public.report_plan_marks   enable row level security;
alter table public.report_photos       enable row level security;

-- ============================================================
-- profiles
-- ============================================================
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
    -- обычный пользователь не может менять себе роль/активность
    and role = (select role from public.profiles where id = auth.uid())
    and is_active = (select is_active from public.profiles where id = auth.uid())
  );

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- projects
-- ============================================================
drop policy if exists projects_select_member_or_admin on public.projects;
create policy projects_select_member_or_admin on public.projects
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.project_memberships m
      where m.project_id = projects.id and m.user_id = auth.uid()
    )
  );

drop policy if exists projects_admin_all on public.projects;
create policy projects_admin_all on public.projects
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- project_memberships
-- ============================================================
drop policy if exists memberships_select_self_or_admin on public.project_memberships;
create policy memberships_select_self_or_admin on public.project_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists memberships_admin_all on public.project_memberships;
create policy memberships_admin_all on public.project_memberships
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- work_types
-- ============================================================
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

-- ============================================================
-- performers
-- ============================================================
drop policy if exists performers_select_active on public.performers;
create policy performers_select_active on public.performers
  for select to authenticated
  using (public.is_active_user());

drop policy if exists performers_admin_all on public.performers;
create policy performers_admin_all on public.performers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- plans
-- ============================================================
drop policy if exists plans_select_member_or_admin on public.plans;
create policy plans_select_member_or_admin on public.plans
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.project_memberships m
      where m.project_id = plans.project_id and m.user_id = auth.uid()
    )
  );

drop policy if exists plans_admin_all on public.plans;
create policy plans_admin_all on public.plans
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- reports
-- ============================================================
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
  );

drop policy if exists reports_admin_all on public.reports;
create policy reports_admin_all on public.reports
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- report_plan_marks
-- ============================================================
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
      select 1 from public.reports r
      where r.id = report_plan_marks.report_id and r.author_id = auth.uid()
    )
  );

drop policy if exists report_marks_admin_all on public.report_plan_marks;
create policy report_marks_admin_all on public.report_plan_marks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- report_photos
-- ============================================================
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
