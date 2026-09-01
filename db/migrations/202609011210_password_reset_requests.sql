-- Заявки на сброс пароля и текущая одноразовая ссылка.
--
-- Почтовой инфраструктуры в проекте нет, поэтому «письмо со ссылкой»
-- невозможно: пользователь оставляет заявку, админ видит её на /admin/users,
-- генерирует ссылку и передаёт вне приложения.
--
-- ОДНА таблица, а не «заявки» + «токены». Живая ссылка у пользователя всегда
-- ровно одна, и здесь это физическое свойство схемы: выдача новой
-- перезаписывает token_hash в той же строке, то есть предыдущая ссылка гаснет
-- сама, а не по договорённости в коде. Инициатива админа без заявки — та же
-- строка с source = 'admin'. Админскому списку при этом не нужен
-- LEFT JOIN LATERAL на каждый рендер.
--
-- status — text + CHECK, а не enum: ALTER TYPE ... ADD VALUE нетранзакционен,
-- а мигратор всегда оборачивает файл в транзакцию (db/migrations/README.md).
-- Статус workflow-таблицы со временем обрастает значениями, и с text это
-- обычная миграция, а с enum — ручная процедура и --mark-applied.
--
-- BEGIN/COMMIT не нужны: транзакцией управляет psql --single-transaction.

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.password_reset_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,

  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','issued','used','cancelled')),
  source             text NOT NULL DEFAULT 'user'
                       CHECK (source IN ('user','admin')),

  requested_at       timestamptz NOT NULL DEFAULT now(),
  last_requested_at  timestamptz NOT NULL DEFAULT now(),
  request_count      integer NOT NULL DEFAULT 1 CHECK (request_count >= 0),
  request_ip         inet,
  request_user_agent text,

  token_hash         text,
  token_issued_at    timestamptz,
  token_expires_at   timestamptz,
  issued_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  used_at            timestamptz,
  used_ip            inet,
  cancelled_at       timestamptz,
  cancelled_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- Три поля токена появляются и исчезают только вместе.
  CONSTRAINT password_reset_requests_token_shape CHECK (
    (token_hash IS NULL     AND token_issued_at IS NULL     AND token_expires_at IS NULL)
    OR
    (token_hash IS NOT NULL AND token_issued_at IS NOT NULL AND token_expires_at IS NOT NULL)
  ),
  CONSTRAINT password_reset_requests_issued_has_token CHECK (
    status <> 'issued' OR token_hash IS NOT NULL
  ),
  CONSTRAINT password_reset_requests_used_shape CHECK (
    (status = 'used') = (used_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.password_reset_requests IS
  'Заявки на сброс пароля и текущая одноразовая ссылка. Почты в проекте нет: '
  'админ видит очередь на /admin/users, генерирует ссылку и передаёт её '
  'пользователю вне приложения.';

COMMENT ON COLUMN public.password_reset_requests.status IS
  'pending — заявка есть, ссылки нет; issued — ссылка выдана и ждёт; '
  'used — пароль сменён; cancelled — заявку сняли. Истёкшая ссылка остаётся '
  'issued: отдельный статус expired требовал бы фонового джоба, а предикат '
  'частичного индекса не может зависеть от now(). Срок проверяется по '
  'token_expires_at.';

COMMENT ON COLUMN public.password_reset_requests.source IS
  'user — пользователь нажал «Забыли пароль?»; admin — сброс начал администратор.';

COMMENT ON COLUMN public.password_reset_requests.request_count IS
  'Сколько раз пользователь просил сброс по этой открытой заявке. 0 — заявку '
  'завёл админ, пользователь не просил.';

COMMENT ON COLUMN public.password_reset_requests.token_hash IS
  'sha256(raw) в hex, как в refresh_tokens. Сырой токен показывается ровно '
  'один раз — в ответе на выдачу ссылки. При использовании НЕ обнуляется: '
  'по нему мы отличаем «ссылка уже использована» от «ссылки не существует».';

-- Не более одной незакрытой заявки на пользователя: повторное «Забыли пароль?»
-- уходит в ON CONFLICT DO UPDATE и не плодит строки в очереди админа.
CREATE UNIQUE INDEX password_reset_requests_open_uniq
  ON public.password_reset_requests (user_id)
  WHERE status IN ('pending','issued');

CREATE UNIQUE INDEX password_reset_requests_token_hash_uniq
  ON public.password_reset_requests (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX password_reset_requests_queue_idx
  ON public.password_reset_requests (status, last_requested_at DESC);

CREATE TRIGGER set_password_reset_requests_updated_at
  BEFORE UPDATE ON public.password_reset_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Колонка существует с самого начала и не используется. Фиксируем почему,
-- чтобы к ней не возвращались: гасить пароль по ПУБЛИЧНОЙ заявке — это
-- тривиальный DoS на чужой аккаунт по одному лишь адресу почты, а гасить при
-- выдаче ссылки — локаут, если ссылка не дошла (опечатка в мессенджере).
-- Обратимый инструмент «заблокировать» уже есть — profiles.is_active.
COMMENT ON COLUMN public.app_users.password_must_reset IS
  'НЕ ИСПОЛЬЗУЕТСЯ. Состояние сброса живёт в password_reset_requests. '
  'Не включать в login: публичная форма «Забыли пароль?» не должна уметь '
  'отключать вход по действующему паролю.';
