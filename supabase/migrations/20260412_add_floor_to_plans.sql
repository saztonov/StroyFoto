-- Добавляет колонку "этаж" к таблице планов
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS floor text;
