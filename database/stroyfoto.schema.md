# stroyfoto — структура БД

Generated: `2026-05-02T14:55:33.481Z`  
PostgreSQL: `PostgreSQL 17.9 (Ubuntu 17.9-201-yandex.59964.2288f7cd41) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0, 64-bit`  
Database: `stroyfoto`

> Автоматически сгенерировано `npm run db:schema:pull`. Не редактировать вручную — для изменения схемы пишите миграцию в `db/migrations/`.

## Содержание

- Schemas: 1
- Extensions: 2
- Enum types: 2
- Domain types: 0
- Tables: 12
- Views: 0
- Materialized views: 0
- Sequences: 0
- Functions/procedures: 1

## Extensions

| Name | Version | Schema |
|------|---------|--------|
| `citext` | 1.6 | public |
| `pgcrypto` | 1.3 | public |

## Enum types

### `public.performer_kind`

`contractor`, `own_forces`

### `public.user_role`

`admin`, `user`

## Tables

### `public.app_users`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `email` | `citext` | no | — | — |  |
| 3 | `password_hash` | `text` | yes | — | — |  |
| 4 | `password_must_reset` | `boolean` | no | false | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |
| 6 | `updated_at` | `timestamp with time zone` | no | now() | — |  |
| 7 | `last_login_at` | `timestamp with time zone` | yes | — | — |  |
| 8 | `deleted_at` | `timestamp with time zone` | yes | — | — |  |

**Constraints**

- **PK** `app_users_pkey` — `PRIMARY KEY (id)`
- **UNIQUE** `app_users_email_key` — `UNIQUE (email)`

**Indexes**

- `app_users_email_key` (unique) — `CREATE UNIQUE INDEX app_users_email_key ON public.app_users USING btree (email)`
- `app_users_pkey` (primary) — `CREATE UNIQUE INDEX app_users_pkey ON public.app_users USING btree (id)`

**Triggers**

- `set_app_users_updated_at` — `CREATE TRIGGER set_app_users_updated_at BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

### `public.performers`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `name` | `citext` | no | — | — |  |
| 3 | `kind` | `performer_kind` | no | — | — |  |
| 4 | `is_active` | `boolean` | no | true | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **PK** `performers_pkey` — `PRIMARY KEY (id)`
- **UNIQUE** `performers_kind_name_key` — `UNIQUE (kind, name)`

**Indexes**

- `performers_kind_name_key` (unique) — `CREATE UNIQUE INDEX performers_kind_name_key ON public.performers USING btree (kind, name)`
- `performers_pkey` (primary) — `CREATE UNIQUE INDEX performers_pkey ON public.performers USING btree (id)`

### `public.plans`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `project_id` | `uuid` | no | — | — |  |
| 3 | `name` | `text` | no | — | — |  |
| 4 | `object_key` | `text` | no | — | — |  |
| 5 | `page_count` | `integer` | yes | — | — |  |
| 6 | `uploaded_by` | `uuid` | yes | — | — |  |
| 7 | `created_at` | `timestamp with time zone` | no | now() | — |  |
| 8 | `floor` | `text` | yes | — | — |  |
| 9 | `building` | `text` | yes | — | — |  |
| 10 | `section` | `text` | yes | — | — |  |
| 11 | `updated_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **CHECK** `plans_page_count_check` — `CHECK (((page_count IS NULL) OR (page_count > 0)))`
- **FK** `plans_project_id_fkey` — `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`
- **FK** `plans_uploaded_by_fkey` — `FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL`
- **PK** `plans_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `plans_pkey` (primary) — `CREATE UNIQUE INDEX plans_pkey ON public.plans USING btree (id)`
- `plans_project_idx` — `CREATE INDEX plans_project_idx ON public.plans USING btree (project_id)`

**Triggers**

- `set_plans_updated_at` — `CREATE TRIGGER set_plans_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

### `public.profiles`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | — | — |  |
| 2 | `full_name` | `text` | yes | — | — |  |
| 3 | `role` | `user_role` | no | 'user'::user_role | — |  |
| 4 | `is_active` | `boolean` | no | false | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |
| 6 | `updated_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **FK** `profiles_id_fkey` — `FOREIGN KEY (id) REFERENCES app_users(id) ON DELETE CASCADE`
- **PK** `profiles_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `profiles_pkey` (primary) — `CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id)`
- `profiles_role_idx` — `CREATE INDEX profiles_role_idx ON public.profiles USING btree (role)`

**Triggers**

- `set_profiles_updated_at` — `CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

### `public.project_memberships`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `project_id` | `uuid` | no | — | — |  |
| 2 | `user_id` | `uuid` | no | — | — |  |
| 3 | `created_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **FK** `project_memberships_project_id_fkey` — `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`
- **FK** `project_memberships_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- **PK** `project_memberships_pkey` — `PRIMARY KEY (project_id, user_id)`

**Indexes**

- `project_memberships_pkey` (primary) — `CREATE UNIQUE INDEX project_memberships_pkey ON public.project_memberships USING btree (project_id, user_id)`
- `project_memberships_user_idx` — `CREATE INDEX project_memberships_user_idx ON public.project_memberships USING btree (user_id)`

### `public.projects`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `name` | `text` | no | — | — |  |
| 3 | `description` | `text` | yes | — | — |  |
| 4 | `created_by` | `uuid` | yes | — | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |
| 6 | `updated_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **FK** `projects_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL`
- **PK** `projects_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `projects_name_lower_uniq` (unique) — `CREATE UNIQUE INDEX projects_name_lower_uniq ON public.projects USING btree (lower(name))`
- `projects_pkey` (primary) — `CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id)`

**Triggers**

- `set_projects_updated_at` — `CREATE TRIGGER set_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

### `public.refresh_tokens`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `user_id` | `uuid` | no | — | — |  |
| 3 | `token_hash` | `text` | no | — | — |  |
| 4 | `expires_at` | `timestamp with time zone` | no | — | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |
| 6 | `last_used_at` | `timestamp with time zone` | yes | — | — |  |
| 7 | `revoked_at` | `timestamp with time zone` | yes | — | — |  |
| 8 | `replaced_by` | `uuid` | yes | — | — |  |
| 9 | `user_agent` | `text` | yes | — | — |  |
| 10 | `ip` | `inet` | yes | — | — |  |

**Constraints**

- **FK** `refresh_tokens_replaced_by_fkey` — `FOREIGN KEY (replaced_by) REFERENCES refresh_tokens(id) ON DELETE SET NULL`
- **FK** `refresh_tokens_user_id_fkey` — `FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE`
- **PK** `refresh_tokens_pkey` — `PRIMARY KEY (id)`
- **UNIQUE** `refresh_tokens_token_hash_key` — `UNIQUE (token_hash)`

**Indexes**

- `refresh_tokens_active_idx` — `CREATE INDEX refresh_tokens_active_idx ON public.refresh_tokens USING btree (user_id) WHERE (revoked_at IS NULL)`
- `refresh_tokens_pkey` (primary) — `CREATE UNIQUE INDEX refresh_tokens_pkey ON public.refresh_tokens USING btree (id)`
- `refresh_tokens_token_hash_key` (unique) — `CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON public.refresh_tokens USING btree (token_hash)`
- `refresh_tokens_user_idx` — `CREATE INDEX refresh_tokens_user_idx ON public.refresh_tokens USING btree (user_id)`

### `public.report_photos`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | — | — |  |
| 2 | `report_id` | `uuid` | no | — | — |  |
| 3 | `object_key` | `text` | no | — | — |  |
| 4 | `thumb_object_key` | `text` | yes | — | — |  |
| 5 | `width` | `integer` | yes | — | — |  |
| 6 | `height` | `integer` | yes | — | — |  |
| 7 | `taken_at` | `timestamp with time zone` | yes | — | — |  |
| 8 | `created_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **CHECK** `report_photos_height_check` — `CHECK (((height IS NULL) OR (height > 0)))`
- **CHECK** `report_photos_width_check` — `CHECK (((width IS NULL) OR (width > 0)))`
- **FK** `report_photos_report_id_fkey` — `FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE`
- **PK** `report_photos_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `report_photos_pkey` (primary) — `CREATE UNIQUE INDEX report_photos_pkey ON public.report_photos USING btree (id)`
- `report_photos_report_idx` — `CREATE INDEX report_photos_report_idx ON public.report_photos USING btree (report_id)`

### `public.report_plan_marks`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `report_id` | `uuid` | no | — | — |  |
| 3 | `plan_id` | `uuid` | no | — | — |  |
| 4 | `page` | `integer` | no | — | — |  |
| 5 | `x_norm` | `numeric(7,6)` | no | — | — |  |
| 6 | `y_norm` | `numeric(7,6)` | no | — | — |  |
| 7 | `created_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **CHECK** `report_plan_marks_page_check` — `CHECK ((page > 0))`
- **CHECK** `report_plan_marks_x_norm_check` — `CHECK (((x_norm >= (0)::numeric) AND (x_norm <= (1)::numeric)))`
- **CHECK** `report_plan_marks_y_norm_check` — `CHECK (((y_norm >= (0)::numeric) AND (y_norm <= (1)::numeric)))`
- **FK** `report_plan_marks_plan_id_fkey` — `FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE`
- **FK** `report_plan_marks_report_id_fkey` — `FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE`
- **PK** `report_plan_marks_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `report_plan_marks_pkey` (primary) — `CREATE UNIQUE INDEX report_plan_marks_pkey ON public.report_plan_marks USING btree (id)`
- `report_plan_marks_plan_idx` — `CREATE INDEX report_plan_marks_plan_idx ON public.report_plan_marks USING btree (plan_id)`
- `report_plan_marks_report_uniq` (unique) — `CREATE UNIQUE INDEX report_plan_marks_report_uniq ON public.report_plan_marks USING btree (report_id)`

### `public.reports`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | — | — |  |
| 2 | `project_id` | `uuid` | no | — | — |  |
| 3 | `work_type_id` | `uuid` | no | — | — |  |
| 4 | `performer_id` | `uuid` | no | — | — |  |
| 5 | `plan_id` | `uuid` | yes | — | — |  |
| 6 | `author_id` | `uuid` | no | — | — |  |
| 7 | `description` | `text` | yes | — | — |  |
| 8 | `taken_at` | `timestamp with time zone` | yes | — | — |  |
| 9 | `created_at` | `timestamp with time zone` | no | now() | — |  |
| 10 | `updated_at` | `timestamp with time zone` | no | now() | — |  |
| 11 | `work_assignment_id` | `uuid` | yes | — | — |  |

**Constraints**

- **FK** `reports_author_id_fkey` — `FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE RESTRICT`
- **FK** `reports_performer_id_fkey` — `FOREIGN KEY (performer_id) REFERENCES performers(id) ON DELETE RESTRICT`
- **FK** `reports_plan_id_fkey` — `FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL`
- **FK** `reports_project_id_fkey` — `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT`
- **FK** `reports_work_assignment_id_fkey` — `FOREIGN KEY (work_assignment_id) REFERENCES work_assignments(id) ON DELETE SET NULL`
- **FK** `reports_work_type_id_fkey` — `FOREIGN KEY (work_type_id) REFERENCES work_types(id) ON DELETE RESTRICT`
- **PK** `reports_pkey` — `PRIMARY KEY (id)`

**Indexes**

- `reports_author_idx` — `CREATE INDEX reports_author_idx ON public.reports USING btree (author_id)`
- `reports_pkey` (primary) — `CREATE UNIQUE INDEX reports_pkey ON public.reports USING btree (id)`
- `reports_project_created_idx` — `CREATE INDEX reports_project_created_idx ON public.reports USING btree (project_id, created_at DESC)`

**Triggers**

- `set_reports_updated_at` — `CREATE TRIGGER set_reports_updated_at BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION set_updated_at()`

### `public.work_assignments`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `name` | `citext` | no | — | — |  |
| 3 | `is_active` | `boolean` | no | true | — |  |
| 4 | `created_by` | `uuid` | yes | — | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **FK** `work_assignments_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL`
- **PK** `work_assignments_pkey` — `PRIMARY KEY (id)`
- **UNIQUE** `work_assignments_name_key` — `UNIQUE (name)`

**Indexes**

- `work_assignments_name_key` (unique) — `CREATE UNIQUE INDEX work_assignments_name_key ON public.work_assignments USING btree (name)`
- `work_assignments_pkey` (primary) — `CREATE UNIQUE INDEX work_assignments_pkey ON public.work_assignments USING btree (id)`

### `public.work_types`

**Columns**

| # | Name | Type | Null | Default | Identity/Generated | Comment |
|---|------|------|------|---------|--------------------|---------|
| 1 | `id` | `uuid` | no | gen_random_uuid() | — |  |
| 2 | `name` | `citext` | no | — | — |  |
| 3 | `is_active` | `boolean` | no | true | — |  |
| 4 | `created_by` | `uuid` | yes | — | — |  |
| 5 | `created_at` | `timestamp with time zone` | no | now() | — |  |

**Constraints**

- **FK** `work_types_created_by_fkey` — `FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL`
- **PK** `work_types_pkey` — `PRIMARY KEY (id)`
- **UNIQUE** `work_types_name_key` — `UNIQUE (name)`

**Indexes**

- `work_types_name_key` (unique) — `CREATE UNIQUE INDEX work_types_name_key ON public.work_types USING btree (name)`
- `work_types_pkey` (primary) — `CREATE UNIQUE INDEX work_types_pkey ON public.work_types USING btree (id)`

## Functions / Procedures

### `public.set_updated_at` (function)

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
```
