-- Добавляем колонки группировки и updated_at
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS building text;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS section text;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Триггер updated_at (реюзаем существующую функцию set_updated_at)
DROP TRIGGER IF EXISTS set_plans_updated_at ON public.plans;
CREATE TRIGGER set_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Участник проекта может обновлять планы (название, этаж, корпус, секция)
DROP POLICY IF EXISTS plans_update_member ON public.plans;
CREATE POLICY plans_update_member ON public.plans
  FOR UPDATE TO authenticated
  USING (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.project_memberships m
      WHERE m.project_id = plans.project_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.project_memberships m
      WHERE m.project_id = plans.project_id AND m.user_id = auth.uid()
    )
  );

-- Загрузивший план может его удалить
DROP POLICY IF EXISTS plans_delete_uploader ON public.plans;
CREATE POLICY plans_delete_uploader ON public.plans
  FOR DELETE TO authenticated
  USING (
    public.is_active_user()
    AND uploaded_by = auth.uid()
  );
