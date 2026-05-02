-- 002_auth_refresh_tokens.sql
-- Хранилище refresh tokens для собственного backend auth.
-- Сырое значение токена клиенту показывается один раз; в БД лежит только sha256(token).
-- Ротация: при /auth/refresh старая запись помечается revoked_at + replaced_by → new id.

BEGIN;

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash    text        NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NULL,
  revoked_at    timestamptz NULL,
  replaced_by   uuid        NULL REFERENCES public.refresh_tokens(id) ON DELETE SET NULL,
  user_agent    text        NULL,
  ip            inet        NULL
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx
  ON public.refresh_tokens (user_id);

CREATE INDEX IF NOT EXISTS refresh_tokens_active_idx
  ON public.refresh_tokens (user_id)
  WHERE revoked_at IS NULL;

COMMIT;
