-- Множественные подрядчики в отчёте: связующая таблица report_performers.
--
-- Expand-фаза. reports.performer_id СОХРАНЯЕТСЯ и продолжает писаться как основной
-- исполнитель: офлайн-клиент может неделями не обновляться и шлёт performer_id в
-- каждом PATCH. Удаление колонки — отдельная поздняя contract-миграция, когда
-- обновятся все клиенты.
--
-- BEGIN/COMMIT здесь не нужны: транзакцией управляет psql --single-transaction.

-- Лучше откатиться, чем надолго заблокировать рабочие записи: таблица reports
-- живая, а машина общая с соседними проектами.
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.report_performers (
  report_id    uuid NOT NULL REFERENCES public.reports(id)    ON DELETE CASCADE,
  performer_id uuid NOT NULL REFERENCES public.performers(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, performer_id)
);

COMMENT ON TABLE public.report_performers IS
  'Подрядчики отчёта. reports.performer_id — основной, дублируется здесь же.';

-- Для фильтра списка отчётов по исполнителям (EXISTS ... WHERE performer_id = ANY(...)).
-- Обратное направление (report_id) покрыто первичным ключом.
CREATE INDEX report_performers_performer_idx
  ON public.report_performers (performer_id);

-- Backfill существующих отчётов.
INSERT INTO public.report_performers (report_id, performer_id)
SELECT id, performer_id FROM public.reports
ON CONFLICT DO NOTHING;

-- Страховка на окно «схема обновлена, API ещё старый». Деплой требует применить
-- миграции ДО выкладки кода (гейт в scripts/deploy.sh), и в этом промежутке старый
-- API создаёт reports, ничего не зная о связке.
--
-- Триггер только ДОБАВЛЯЕТ основную связь и никогда не удаляет: иначе он затирал бы
-- работу нового API, который управляет набором явно.
--
-- Известное временное поведение: если в этом окне старый API сменит performer_id с A
-- на B, останется [A, B] вместо [B]. Для данных безопасно — ничего не теряется, —
-- но лишний подрядчик сам не исчезнет, поэтому миграцию и деплой делают подряд.
CREATE FUNCTION public.sync_report_primary_performer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.report_performers (report_id, performer_id)
  VALUES (NEW.id, NEW.performer_id)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

CREATE TRIGGER sync_report_primary_performer
AFTER INSERT OR UPDATE OF performer_id ON public.reports
FOR EACH ROW EXECUTE FUNCTION public.sync_report_primary_performer();
