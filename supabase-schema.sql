-- =====================================================
-- StroyFoto: Supabase Database Schema
-- Выполнить в Supabase SQL Editor
-- =====================================================

-- 1. ENUM-типы
CREATE TYPE user_role AS ENUM ('ADMIN', 'WORKER');
CREATE TYPE sync_status AS ENUM ('PENDING', 'SYNCED', 'CONFLICT');
CREATE TYPE upload_status AS ENUM ('PENDING_UPLOAD', 'UPLOADED');

-- 2. UUID-расширение (обычно уже включено в Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ТАБЛИЦЫ
-- =====================================================

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  role       user_role NOT NULL DEFAULT 'WORKER',
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token      TEXT NOT NULL UNIQUE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user_id    ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE TABLE projects (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,
  address    TEXT NOT NULL DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE work_types (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contractors (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE areas (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  project_id UUID REFERENCES projects(id),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_areas_project_id ON areas(project_id);

CREATE TABLE reports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id   TEXT NOT NULL UNIQUE,
  project_id  UUID NOT NULL REFERENCES projects(id),
  date_time   TIMESTAMPTZ NOT NULL,
  mark        TEXT NOT NULL,
  work_type   TEXT NOT NULL,
  area        TEXT NOT NULL,
  contractor  TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  user_id     UUID NOT NULL REFERENCES users(id),
  sync_status sync_status NOT NULL DEFAULT 'SYNCED',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_user_id    ON reports(user_id);
CREATE INDEX idx_reports_project_id ON reports(project_id);
CREATE INDEX idx_reports_date_time  ON reports(date_time);
CREATE INDEX idx_reports_updated_at ON reports(updated_at);

CREATE TABLE photos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     TEXT NOT NULL UNIQUE,
  report_id     UUID NOT NULL REFERENCES reports(id),
  bucket        TEXT NOT NULL DEFAULT 'stroyfoto',
  object_key    TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  upload_status upload_status NOT NULL DEFAULT 'UPLOADED',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photos_report_id ON photos(report_id);

-- =====================================================
-- ТРИГГЕР auto-update updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_users       BEFORE UPDATE ON users       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_projects    BEFORE UPDATE ON projects    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_work_types  BEFORE UPDATE ON work_types  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_contractors BEFORE UPDATE ON contractors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_areas       BEFORE UPDATE ON areas       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_reports     BEFORE UPDATE ON reports     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at_photos      BEFORE UPDATE ON photos      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEW для подсчёта фото в отчётах
-- =====================================================

CREATE VIEW reports_with_photo_count AS
SELECT r.*, (SELECT count(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
FROM reports r;

-- =====================================================
-- RPC-функции
-- =====================================================

CREATE OR REPLACE FUNCTION reports_count_by_project()
RETURNS TABLE(project_id UUID, count BIGINT) AS $$
  SELECT project_id, count(*) FROM reports GROUP BY project_id;
$$ LANGUAGE sql STABLE;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos         ENABLE ROW LEVEL SECURITY;

-- Запрет прямого доступа через anon key (всё идёт через API с service_role)
CREATE POLICY "Deny anon users"          ON users          FOR ALL USING (false);
CREATE POLICY "Deny anon refresh_tokens" ON refresh_tokens FOR ALL USING (false);
CREATE POLICY "Deny anon reports"        ON reports        FOR ALL USING (false);
CREATE POLICY "Deny anon photos"         ON photos         FOR ALL USING (false);

-- Справочники: чтение только активных
CREATE POLICY "Read active projects"    ON projects    FOR SELECT USING (is_active = true);
CREATE POLICY "Read active work_types"  ON work_types  FOR SELECT USING (is_active = true);
CREATE POLICY "Read active contractors" ON contractors FOR SELECT USING (is_active = true);
CREATE POLICY "Read active areas"       ON areas       FOR SELECT USING (is_active = true);

-- =====================================================
-- STORAGE BUCKET
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'stroyfoto',
  'stroyfoto',
  false,
  15728640,  -- 15 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- Storage: запрет прямого доступа
CREATE POLICY "Deny anon storage" ON storage.objects FOR ALL USING (false);
CREATE POLICY "Service role storage" ON storage.objects FOR ALL USING (true) WITH CHECK (true);
