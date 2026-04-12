-- Автор может обновлять свой отчёт (нельзя менять project_id и author_id)
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
    and project_id = (select r.project_id from public.reports r where r.id = reports.id)
    and author_id = (select r.author_id from public.reports r where r.id = reports.id)
  );

-- Автор может удалять свой отчёт
drop policy if exists reports_delete_author on public.reports;
create policy reports_delete_author on public.reports
  for delete to authenticated
  using (
    public.is_active_user()
    and author_id = auth.uid()
  );

-- Активный участник проекта может загружать планы
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
