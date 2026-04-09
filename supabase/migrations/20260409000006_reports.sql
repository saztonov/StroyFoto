-- Отчёты, точки на плане и фотографии. UUID для reports/photos — клиентские (офлайн-идемпотентность).

create table if not exists public.reports (
  id            uuid primary key,
  project_id    uuid not null references public.projects(id)   on delete restrict,
  work_type_id  uuid not null references public.work_types(id) on delete restrict,
  performer_id  uuid not null references public.performers(id) on delete restrict,
  plan_id       uuid          references public.plans(id)      on delete set null,
  author_id     uuid not null references public.profiles(id)   on delete restrict,
  description   text,
  taken_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists reports_project_created_idx on public.reports (project_id, created_at desc);
create index if not exists reports_author_idx          on public.reports (author_id);

drop trigger if exists set_updated_at on public.reports;
create trigger set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

-- Точка на плане: в MVP одна на отчёт, но схема расширяется до точки на фото
-- (можно будет добавить photo_id и снять unique).
create table if not exists public.report_plan_marks (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  plan_id     uuid not null references public.plans(id)   on delete restrict,
  page        int  not null check (page > 0),
  x_norm      numeric(7,6) not null check (x_norm >= 0 and x_norm <= 1),
  y_norm      numeric(7,6) not null check (y_norm >= 0 and y_norm <= 1),
  created_at  timestamptz not null default now()
);

create unique index if not exists report_plan_marks_report_uniq on public.report_plan_marks (report_id);
create index if not exists report_plan_marks_plan_idx on public.report_plan_marks (plan_id);

create table if not exists public.report_photos (
  id            uuid primary key,
  report_id     uuid not null references public.reports(id) on delete cascade,
  r2_key        text not null,
  thumb_r2_key  text,
  width         int  check (width  is null or width  > 0),
  height        int  check (height is null or height > 0),
  taken_at      timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists report_photos_report_idx on public.report_photos (report_id);
