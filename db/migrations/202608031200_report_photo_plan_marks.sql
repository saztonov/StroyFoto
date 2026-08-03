-- Точка на плане для каждого 360-фото: таблица report_photo_plan_marks.
--
-- ОТДЕЛЬНАЯ таблица, а не photo_id в report_plan_marks. Причина: миграции
-- применяются ДО выкладки кода, а старый API в этом промежутке продолжает
-- работать. Он делает `INSERT ... ON CONFLICT (report_id) DO UPDATE` — для
-- арбитража нужен обычный уникальный индекс по report_id, и частичный
-- (WHERE photo_id IS NULL) его не заменит: PostgreSQL такой индекс не выберет.
-- Плюс старый clearPlanMark делает DELETE ... WHERE report_id = $1, то есть
-- откат API снёс бы все точки фотографий.
--
-- Поэтому report_plan_marks остаётся легаси-таблицей «одна общая точка на
-- отчёт» и здесь не трогается вовсе. Ответ API объединяет обе.
--
-- BEGIN/COMMIT не нужны: транзакцией управляет psql --single-transaction.

SET LOCAL lock_timeout = '5s';

-- --- версия набора фото-точек -----------------------------------------------
-- Отдельная от updated_at намеренно. Переиспользование updated_at давало бы
-- самоконфликт: в офлайн-батче report_update сдвигает updated_at, а идущий
-- следом mark_update отправляет прежний токен и получает 409 от собственной
-- же предыдущей операции. Протащить новый токен неоткуда — updateRemoteReport
-- возвращает void, а MarkUpdateRecord OCC-поля не имеет.
ALTER TABLE public.reports
  ADD COLUMN photo_marks_version bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.reports.photo_marks_version IS
  'OCC-версия набора фото-точек. Обычное редактирование отчёта её не двигает.';

-- --- принадлежность фото отчёту ---------------------------------------------
-- Нужен для составного FK ниже: одиночный FK на photo_id допустил бы точку
-- на снимке чужого отчёта.
ALTER TABLE public.report_photos
  ADD CONSTRAINT report_photos_report_id_id_uniq UNIQUE (report_id, id);

-- --- сами точки --------------------------------------------------------------
CREATE TABLE public.report_photo_plan_marks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  photo_id   uuid NOT NULL,
  plan_id    uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  page       integer NOT NULL CHECK (page > 0),
  x_norm     numeric(7,6) NOT NULL CHECK (x_norm >= 0 AND x_norm <= 1),
  y_norm     numeric(7,6) NOT NULL CHECK (y_norm >= 0 AND y_norm <= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_photo_plan_marks_photo_fkey
    FOREIGN KEY (report_id, photo_id)
    REFERENCES public.report_photos (report_id, id) ON DELETE CASCADE,
  -- Одна точка на фотографию.
  CONSTRAINT report_photo_plan_marks_photo_uniq UNIQUE (photo_id)
);

COMMENT ON TABLE public.report_photo_plan_marks IS
  'Точка на плане для конкретной фотографии (1 точка = 1 фото 360). '
  'report_plan_marks остаётся легаси-таблицей с одной общей точкой на отчёт.';

CREATE INDEX report_photo_plan_marks_report_idx
  ON public.report_photo_plan_marks (report_id);
CREATE INDEX report_photo_plan_marks_plan_idx
  ON public.report_photo_plan_marks (plan_id);

-- --- починка существующего расхождения ---------------------------------------
-- Клиент рассчитывает, что удаление используемого плана запрещено: комментарий
-- в src/services/plans.ts обещает «FK RESTRICT» и обработку 422 PLAN_IN_USE.
-- Фактически стоял ON DELETE CASCADE, то есть удаление плана молча стирало все
-- его метки.
ALTER TABLE public.report_plan_marks
  DROP CONSTRAINT report_plan_marks_plan_id_fkey,
  ADD  CONSTRAINT report_plan_marks_plan_id_fkey
       FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE RESTRICT;
