# Аудит миграции StroyFoto: Supabase.com → собственный backend + Yandex Managed PostgreSQL

Дата аудита: 2026-05-01.
Статус: одобрено к реализации (полный план реализации — `C:\Users\Usr\.claude\plans\reflective-swimming-zephyr.md`).

## 1. Цель миграции

- Убрать зависимость фронтенда от `@supabase/supabase-js` и Supabase.com в целом.
- Перенести БД в Yandex Managed Service for PostgreSQL.
- Браузер НЕ подключается к Postgres напрямую — только через HTTPS API.
- Сохранить текущий UX: авторизация, роли admin/user, активация пользователей, проекты, отчёты, планы, фото, offline sync, IndexedDB-кэш, Cloud.ru Object Storage, presigned URLs.
- Сохранить текущие права доступа, реализованные через Supabase RLS.

---

## 2. Полный инвентарь Supabase-зависимостей

### 2.1 Инициализация и сессия
| Что | Где | Детали |
|---|---|---|
| Создание клиента | `src/lib/supabase.ts` | `createClient(url, anonKey, {persistSession, autoRefreshToken, detectSessionInUrl, storageKey: 'stroyfoto:auth'})` |
| Env | `src/shared/config/env.ts` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Пакет | `package.json` | `@supabase/supabase-js ^2.45.4` |
| Импорты типов | множество файлов | `Session`, `User`, `AuthError`, `RealtimeChannel` |

### 2.2 Auth (`supabase.auth.*`)
| Метод | Файл | Назначение |
|---|---|---|
| `signInWithPassword` | `src/services/auth.ts:8` | Вход email/пароль |
| `signUp({options:{data:{full_name}}})` | `src/services/auth.ts:17` | Регистрация |
| `signOut` | `src/services/auth.ts:29` | Выход |
| `getSession` | `src/app/providers/AuthProvider.tsx:112` | Стартовая загрузка сессии |
| `onAuthStateChange` | `src/app/providers/AuthProvider.tsx:120` | Подписка на смену сессии |
| `getSession` | `src/services/r2.ts:55` | Извлечение access_token для Edge Function |

### 2.3 CRUD-вызовы `supabase.from(...)` (по таблицам)
| Таблица | Файлы | Операции |
|---|---|---|
| `profiles` | `services/auth.ts`, `services/admin.ts` | `select(maybeSingle)`, `update(eq)` |
| `reports` | `services/reports/{list,details,mutations}.ts`, `services/reconcile.ts`, `services/sync.ts` | `select` (с nested `report_photos`/`report_plan_marks`), `insert`, `update(eq)` с OCC через `expectedUpdatedAt`, `delete(eq)`, `order`, `limit`, `lt(cursor)` |
| `report_photos` | `services/photos.ts`, `services/sync.ts` | `upsert(onConflict:'id')`, `delete(eq)` |
| `report_plan_marks` | `services/reports/mutations.ts`, `services/sync.ts` | `delete(eq)` + `insert` |
| `plans` | `services/plans.ts`, `services/catalogs.ts` | `select(eq, order)`, `insert(select.single)`, `update(eq).select.single`, `delete(eq)` |
| `projects` | `services/catalogs.ts`, `services/admin.ts` | `select+order+limit`, `insert`, `update`, `delete` |
| `project_memberships` | `services/admin.ts` | `select(eq)`, `insert` (массив), `delete(eq).in(project_id)` |
| `work_types` | `services/catalogs.ts`, `services/admin.ts`, `services/sync.ts` | `select`, `insert`, `update(eq)`, `is_active toggle` |
| `work_assignments` | те же | то же |
| `performers` | `services/catalogs.ts`, `services/admin.ts` | `select`, `insert`, `update`, `is_active toggle` |

### 2.4 RPC (`supabase.rpc(...)`)
| RPC | Файлы | Назначение |
|---|---|---|
| `admin_list_profiles()` | `services/admin.ts:16` | Список профилей с email из auth.users |
| `get_author_name(p_author_id)` | `services/reports/{list,details}.ts` | ФИО автора отчёта |
| `get_author_names(p_author_ids[])` | `services/reports/list.ts`, `services/reconcile.ts` | Батч ФИО (с fallback на одиночный) |

### 2.5 Edge Functions (`supabase.functions.invoke`)
- Единственная — `sign` (`src/services/r2.ts:61`).
- Авторизация: явно прокинутый Bearer (обход бага supabase-js v2 с автопрокидкой токена).
- Body: `{op, kind, key, reportId?, projectId?, planId?, contentType?, provider?}`.

### 2.6 Realtime (`supabase.channel().on('postgres_changes')`)
Один канал `stroyfoto-changes` в `src/services/invalidation.ts`. Подписки на 9 таблиц:
| Таблица | Действие |
|---|---|
| `reports` | `fireReport(id, op) + fireReports()` |
| `report_photos` | `fireReport(reportId, 'update') + fireReports()` |
| `report_plan_marks` | `fireReport(reportId, 'update') + fireReports()` |
| `plans` | `firePlans()` |
| `work_types` | `fireCatalogs()` |
| `performers` | `fireCatalogs()` |
| `work_assignments` | `fireCatalogs()` |
| `projects` | `fireCatalogs() + fireReports()` |
| `project_memberships` | `fireCatalogs() + fireReports()` |

Дополнительно:
- Фильтрация собственных pending-изменений через IDB (`isOwnPendingReport`).
- BroadcastChannel `stroyfoto-invalidation` для cross-tab (НЕ Supabase, остаётся как есть).
- 30s sync polling в `services/sync.ts:438` — safety net при разрыве канала.

### 2.7 Серверная часть Supabase, которую переносим
- Таблицы `public.*`: `profiles`, `projects`, `project_memberships`, `work_types`, `work_assignments`, `performers`, `plans`, `reports`, `report_photos`, `report_plan_marks`.
- ENUM: `user_role` (`admin`/`user`), `performer_kind` (`contractor`/`own_forces`).
- `citext` для `name` полей в `work_types`/`work_assignments`/`performers`.
- Триггеры: `set_updated_at` (BEFORE UPDATE) на plans/profiles/projects/reports; `handle_new_user` (auth.users → profiles).
- SECURITY DEFINER функции: `is_admin()`, `is_active_user()`, `admin_list_profiles()`, `get_author_name()`, `get_author_names()`.
- RLS политики на всех таблицах (используют `auth.uid()` и хелпер-функции).
- Edge Function `supabase/functions/sign/index.ts`: SigV4 для Cloud.ru S3 / R2, валидация JWT через `auth.getUser()`, проверка прав (автор фото / член проекта / admin).

### 2.8 Что НЕ переносится напрямую (Supabase-only)
| Фича | Замена |
|---|---|
| Схема `auth` (`auth.users`, `auth.uid()`, `auth.jwt()`) | Своя таблица `users` + JWT issuer на backend |
| `request.jwt.claims` (PostgREST) | Middleware `requireAuth` кладёт `{userId, role, isActive}` в `request.user` |
| Realtime postgres_changes | WebSocket на Fastify + LISTEN/NOTIFY |
| Storage schema | Не используется (бинари в Cloud.ru) |

---

## 3. Покрытие будущими REST API routes

База: `/api/v1`. JSON. OCC через `expectedUpdatedAt` в body. Cursor pagination — `?cursor=<iso>&limit=50`.

| Группа | Endpoints | Доступ |
|---|---|---|
| auth | POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; GET `/auth/me` | guest (кроме `/me`, `/logout`) |
| profiles | PATCH `/profiles/me` | user |
| admin/users | GET `/admin/users`, PATCH `/admin/users/:id`, GET/PUT `/admin/users/:id/projects` | admin |
| admin/projects | GET/POST/PATCH/DELETE `/admin/projects[/:id]` | admin |
| admin/work-types, work-assignments, performers | GET, POST, PATCH `:id`, PATCH `:id/active` | admin |
| catalogs | GET `/catalogs/projects`, `/work-types`, `/work-assignments`, `/performers`, `/plans[?projectId=]`; POST `/catalogs/work-types`, `/work-assignments` | active user |
| reports | GET `/reports`, `/reports/:id`; POST `/reports`, `/reports/authors/lookup`; PATCH `/reports/:id`; DELETE `/reports/:id` | active user |
| photos | POST `/reports/:id/photos`; DELETE `/photos/:id` | active user |
| plans | POST `/plans`; PATCH `/plans/:id`, `/plans/:id/file`; DELETE `/plans/:id` | active user / admin |
| plan-marks | PUT `/reports/:id/plan-mark` | active user |
| presign | POST `/presign` (порт `sign/index.ts`) | active user (R2 — admin) |
| storage-migration | GET `/admin/storage-migration/overview`, `/items`; POST `/mark-cloudru` | admin |
| realtime | WSS `/realtime?token=<jwt>` | active user |

---

## 4. Список рисков миграции

| Риск | Уровень | Митигация |
|---|---|---|
| **Пароли непереносимы** (Supabase Auth хеширует с server-side pepper) | High | `password_hash='!INVALID!'` + flow «Забыли пароль?» при первом логине. Баннер на странице логина. Rehearsal на staging. |
| **Что-то держится только на RLS, не в коде** | High | До удаления RLS — таблица «политика → API guard». Интеграционные тесты со всеми ролями (admin/member/foreigner). |
| **Realtime-задержка/разрыв в PWA** | Medium | Авто-reconnect WebSocket с exp backoff (1s→30s). 30s sync polling в `sync.ts:438` остаётся safety net. На `visibilitychange=hidden` — отключение, на `visible` — пересоздание. |
| **WebSocket в фоне на iOS PWA** | Medium | Управление по visibility, на reconnect — `lastEventTs` для delta-pull или просто invalidate всё. |
| **OCC регрессия** (формат `updated_at` отличается) | Low | ISO-8601 с микросекундами, сравнение строкой; 409 → клиент рефетчит (поведение как сейчас). |
| **LocalStorage/IDB XSS** | Medium | Жёсткий CSP без `unsafe-inline`; access-token в памяти, refresh — в отдельном IDB store. |
| **CORS, preflight на проде** | Low | `@fastify/cors` whitelist origins; `Access-Control-Max-Age: 600`. |
| **Rate-limit/DDoS** (раньше Supabase брал на себя) | Medium | `@fastify/rate-limit` + edge rate-limit на балансировщике. Особо `/auth/login`: 60/min per email + IP. |
| **Yandex MDB nuances** | Medium | citext, pgcrypto в дефолтном whitelist. max_connections ~200 на S2 — pool 20 на инстанс. pgbouncer transaction-mode совместим (не используем `SET LOCAL`). IP whitelist + `sslmode=verify-full`. |
| **Деплой/rollback** | Medium | Feature flag `VITE_USE_NEW_BACKEND`. Cutover — DNS swap; rollback = вернуть env. БД Supabase не уничтожать ещё 14 дней. |
| **Edge Function → Node: cold start** | Low | Node-процесс греется, проблема исчезает. |
| **Стоимость** | Low–Medium | Yandex MDB S2 burstable + 1 VM с Node ≈ Supabase Pro. Realtime в нашем процессе бесплатно. |

---

## 5. Рекомендуемый порядок работ

| # | Этап | Критерий приёмки |
|---|---|---|
| 1 | Backend skeleton: Fastify + JWT + users + refresh_tokens + базовые миграции | register/login/refresh/logout/me работают через Postman; argon2id + refresh rotation покрыты unit-тестами |
| 2 | Перенос схемы в Yandex MDB | Миграции 001-004 применены в staging; psql CRUD проходит |
| 3 | Бизнес-роуты (catalogs, reports, photos, plans, plan-marks, admin/*) | Postman-коллекция воспроизводит каждый сценарий из `src/services/*` |
| 4 | Presign route — порт `sign/index.ts` 1:1 | PUT JPEG в Cloud.ru, GET, DELETE; PUT в R2 запрещён; GET/DELETE в R2 только для admin |
| 5 | Realtime WS + триггеры NOTIFY + LISTEN-клиент | Два WS-клиента видят INSERT в reports < 500ms; admin видит всё, member — только свои проекты |
| 6 | Frontend замена слоями (8 подэтапов): (1) api/client+auth+AuthProvider; (2) catalogs; (3) reports/{list,details,mutations}; (4) photos+r2+sync; (5) plans; (6) admin; (7) realtime+invalidation; (8) storageMigration | На каждом подэтапе компиляция проходит; e2e-сценарий «создать офлайн → синк → увидеть на втором устройстве» работает |
| 7 | Параллельный staging + feature flag, 1-2 недели на тестовых учётках | Smoke + регрессия пройдены |
| 8 | Cutover (maintenance-окно): dump+restore данных, `password_hash='!INVALID!'`, DNS swap, баннер «сбросьте пароль» | Реальные пользователи логинятся через forgot-password |
| 9 | Через 14 дней: snapshot Supabase, удалить supabase-js, удалить `src/lib/supabase.ts`, `supabase/functions/sign/`, `VITE_SUPABASE_*` из CI | Поиск по коду — нет упоминаний `supabase` |

---

## 6. Принятые архитектурные решения

| Решение | Выбрано | Альтернатива |
|---|---|---|
| Backend layout | Монорепо (новая папка `server/`) | Отдельный репозиторий |
| Realtime transport | WebSocket на том же Fastify (`@fastify/websocket`) + LISTEN/NOTIFY | SSE; socket.io |
| Auth-токены | Bearer + IndexedDB (refresh) + in-memory (access) | HttpOnly cookie |
| Авторизация | Полностью в API-слое; RLS отключаем | `SET LOCAL request.jwt.claims` + RLS |
| `users` vs `profiles` | Слить в одну таблицу `users` | Оставить split |
| Пароли при cutover | Стандартный flow «Забыли пароль?» при первом логине | Батчевая рассылка с готовыми токенами |

Полное обоснование каждого решения — в файле плана `C:\Users\Usr\.claude\plans\reflective-swimming-zephyr.md`.
