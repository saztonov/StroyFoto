-- Миграция: RLS-политики для редактирования фото и меток отчёта автором.
-- Автор отчёта теперь может удалять свои фото и обновлять/удалять метки на плане.

-- report_photos: DELETE для автора отчёта
drop policy if exists report_photos_delete_author on public.report_photos;
create policy report_photos_delete_author on public.report_photos
  for delete to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.reports r
      where r.id = report_photos.report_id and r.author_id = auth.uid()
    )
  );

-- report_plan_marks: UPDATE для автора отчёта
drop policy if exists report_marks_update_author on public.report_plan_marks;
create policy report_marks_update_author on public.report_plan_marks
  for update to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.reports r
      where r.id = report_plan_marks.report_id and r.author_id = auth.uid()
    )
  )
  with check (
    public.is_active_user()
    and exists (
      select 1 from public.reports r
      join public.plans p on p.id = report_plan_marks.plan_id
      where r.id = report_plan_marks.report_id
        and r.author_id = auth.uid()
        and p.project_id = r.project_id
    )
  );

-- report_plan_marks: DELETE для автора отчёта
drop policy if exists report_marks_delete_author on public.report_plan_marks;
create policy report_marks_delete_author on public.report_plan_marks
  for delete to authenticated
  using (
    public.is_active_user()
    and exists (
      select 1 from public.reports r
      where r.id = report_plan_marks.report_id and r.author_id = auth.uid()
    )
  );
