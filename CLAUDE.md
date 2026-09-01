# СтройФото — руководство по кодовой базе

Русскоязычное PWA для фотоконтроля строительства. Статус: **рабочий MVP**.

## Стек

| Слой | Технология |
|------|-----------|
| Сборка | Vite 6 + TypeScript (strict) |
| UI | React 18 + Ant Design 5 (`ru_RU`) |
| Роутинг | React Router v6 (`createBrowserRouter`) |
| Backend | Node 20 + Fastify 4 (`server/`) |
| БД | Yandex Managed PostgreSQL (актуальная схема — в [database/](database/), см. `stroyfoto.schema.sql/.json/.md`) |
| Auth | Собственный JWT: access в памяти браузера (claim `sv` — поколение сессий), refresh в IDB `auth_session` либо `sessionStorage`; bcrypt-хэш паролей на сервере (bcryptjs, cost=12) |
| Файлы | Cloud.ru Object Storage (`s3.cloud.ru`, ru-central-1, приватный bucket) |
| Presign | Fastify-роут `POST /api/storage/presign` (`server/src/services/presignService.ts`, aws4fetch SigV4) |
| Offline | IndexedDB (`idb` v8), sync queue, retention |
| PWA | vite-plugin-pwa (autoUpdate, Workbox) |
| Фото | browser-image-compression (Web Worker) |
| PDF | pdfjs-dist 5.6 |

Фронт ходит только в `/api/*`; секреты Cloud.ru S3 живут в `server/.env` и не попадают в клиент.

## Архитектура

```
Browser/PWA
  ├─ React UI (Ant Design)
  ├─ React Context: AuthProvider, ThemeProvider
  ├─ Сервисный слой (src/services/*)
  ├─ IndexedDB (14 stores, idb)
  │
 └─► Fastify API (own JWT)  — server/src/routes/*
       ├─► Yandex Managed PostgreSQL (pg pool; авторизация в API, RLS не используется)
       └─► POST /api/storage/presign — presigned URL к Cloud.ru S3 (SigV4)

Browser  ── PUT/GET ──►  Cloud.ru Object Storage (по presigned URL)
```

Серверный push (WebSocket / SSE / LISTEN-NOTIFY) пока не реализован: invalidation между вкладками — через BroadcastChannel; между устройствами — polling sync (30/120с) + reconcile при `online`/`visibilitychange`.

**Состояние:** React Context (Auth + Theme) + сервисный слой + IndexedDB. Redux/Zustand нет — осознанный выбор для MVP.

**Offline-first:** все мутации сначала пишутся в IndexedDB и мгновенно отображаются в UI. Фоновая очередь синхронизирует с сервером.

## Структура проекта

```
src/
├── app/              # App.tsx, провайдеры, роутер, layouts
│   ├── providers/    # AuthProvider.tsx, ThemeProvider.tsx
│   ├── router/       # routes.tsx (lazy-loaded pages), guards.tsx
│   └── layouts/      # AppShell, DesktopLayout, MobileLayout, AuthLayout
├── pages/            # Страницы по разделам
│   ├── auth/         # LoginPage, RegisterPage, PendingActivationPage
│   ├── reports/      # ReportsListPage, NewReportPage, ReportDetailsPage
│   │   └── components/  # PhotoPicker, PdfPlanCanvas, PlanMarkPicker,
│   │                     # WorkTypeSelect, PerformerSelect, EditReportModal
│   ├── plans/        # PlansPage + ZoomablePdfPreview
│   ├── admin/        # UsersPage, ProjectsPage, WorkTypesPage, PerformersPage,
│   │                 # WorkAssignmentsPage
│   └── settings/     # SettingsPage (профиль, тема, retention, PWA install)
├── entities/         # Доменные типы: Profile, Project, WorkType, Performer
├── services/         # Бизнес-логика (без UI)
│   ├── sync.ts           # Главный sync loop (30с/120с + events)
│   ├── fullSync.ts       # Полная синхронизация (catalogs + plans + reports)
│   ├── reconcile.ts      # Лёгкий pull после reconnect
│   ├── invalidation.ts   # Realtime подписки + BroadcastChannel (cross-tab)
│   ├── reports.ts        # CRUD отчётов (local + remote merge)
│   ├── reports/          # Подмодули: mappers, mutations, types, details, cache, list
│   ├── localReports.ts   # IDB-операции над черновиками
│   ├── photos.ts         # Сжатие, IDB-хранение, статусы
│   ├── plans.ts          # Скачивание PDF, IDB-кэш
│   ├── objectStorage.ts  # Presigned URL к Cloud.ru S3 + put/get/timeout
│   ├── catalogs.ts       # Загрузка справочников + IDB-кэш
│   ├── retention.ts      # Очистка старых данных по настройке
│   ├── deviceSettings.ts # Настройки устройства в IDB
│   ├── storageQuota.ts   # Мониторинг квоты IndexedDB
│   ├── appUpdate.ts      # PWA update notifications
│   ├── profileCache.ts   # Кэш профиля пользователя в IDB
│   ├── admin.ts          # Админские операции
│   └── auth.ts           # signUp, login, signOut, loadProfile, restoreSession,
│                         # смена пароля и сброс по ссылке
├── shared/
│   ├── hooks/        # useAuth, useTheme, useBreakpoint, useOnlineStatus,
│   │                 # usePwaInstall, useAdminResource
│   ├── i18n/ru.ts    # Все строки интерфейса на русском
│   ├── ui/           # SyncBanner, ThemeToggle, ErrorBoundary,
│   │                 # EmptySection, PageHeader, IdbBlockedNotice,
│   │                 # StorageWarningNotice
│   └── config/env.ts # Нормализация VITE_API_URL (default '/api')
├── lib/
│   ├── apiClient.ts  # Typed fetch wrapper + transparent refresh по 401
│   ├── authStorage.ts# Refresh-token: IDB auth_session (persistent) или sessionStorage
│   ├── db.ts         # IndexedDB: StroyFotoDB v89, 14 stores, getDB()
│   └── platform/     # Абстракция камеры (готова для Capacitor)
│       ├── index.ts
│       └── camera.ts # Web-реализация CameraAdapter
└── main.tsx          # Точка входа: dayjs ru, retention, PWA register

server/                # Fastify backend (Node 20)
├── src/
│   ├── server.ts     # bootstrap
│   ├── app.ts        # Fastify + регистрация роутов
│   ├── db.ts         # pg.Pool
│   ├── config.ts     # env + zod
│   ├── auth/         # authenticate, requireActiveUser, requireAdmin, JWT issue/verify
│   ├── routes/       # auth, profile, catalogs, reports, photos, plans,
│   │                 # presign, admin/*, authorNames, health
│   ├── services/     # presignService и др.
│   ├── http/         # error mapping
│   └── access/       # authz-предикаты (membership и т.п.)
└── tsconfig.json

db/migrations/        # SQL-миграции схемы (журнал schema_migrations)
database/             # Snapshot структуры БД (auto-generated):
                      #   stroyfoto.schema.sql, stroyfoto.schema.json,
                      #   stroyfoto.schema.md
scripts/db/           # apply-migrations.sh, export-schema.ts
                      # (npm run migrate:db перегенерирует database/*)
```

## Модель данных

### Серверная схема (Postgres)

| Таблица | Назначение |
|---------|-----------|
| `app_users` / `profiles` | Auth + профиль (1:1 по id): email, password_hash (**bcryptjs, cost=12**), full_name, role, is_active, `session_version` |
| `refresh_tokens` | Активные refresh-сессии (rotation, expires_at, session_version) |
| `password_reset_requests` | Заявки на сброс пароля и текущая одноразовая ссылка (одна строка на пользователя; `token_hash` = sha256) |
| `projects` | Проекты |
| `project_memberships` | Назначение пользователей на проекты |
| `work_types` | Виды работ (создание — только админ; штатный вывод из оборота — `is_active = false`; физическое удаление возможно только для позиций, не использованных ни в одном отчёте — FK `reports.work_type_id` объявлен `ON DELETE RESTRICT`) |
| `work_assignments` | Назначения работ (создание — только админ; штатный вывод из оборота — `is_active = false`; удаление — только для позиций без отчётов, причём FK `reports.work_assignment_id` объявлен `ON DELETE SET NULL` и **не** защищает: проверка использования сделана явно в `deleteDictAdmin`) |
| `performers` | Исполнители: kind = `contractor` / `own_forces` |
| `plans` | PDF-планы по проектам (object_key, page_count) |
| `reports` | Отчёты (project, work_type, performer, plan, author). `performer_id` — **основной** подрядчик; полный набор — в `report_performers` |
| `report_performers` | Подрядчики отчёта (M:N). Expand-фаза: `reports.performer_id` сохранён для старых офлайн-клиентов, триггер `sync_report_primary_performer` держит основную связь в актуальном состоянии |
| `report_plan_marks` | Точки на плане (normalized xNorm/yNorm) |
| `report_photos` | Фотографии (object_key, thumb_object_key) |

> Бинарные объекты (фото, PDF-планы) лежат в Cloud.ru Object Storage;
> в БД хранятся только `object_key` и `thumb_object_key` — детерминированные
> ключи, сгенерированные клиентом (`photos/{reportId}/{photoId}.jpg`,
> `plans/{projectId}/{planId}.pdf`).

**Авторизация** реализована в Fastify-роутах через middleware
`authenticate` / `requireActiveUser` / `requireAdmin`
([server/src/auth/](server/src/auth/)); `pool.query` без request-bound
claims. RLS на стороне БД не используется.

### IndexedDB (StroyFotoDB v89, 14 stores)

| Store | Назначение |
|-------|-----------|
| `reports` | Локальные черновики + sync metadata |
| `photos` | Blob фото + thumbnail (origin: local/remote) |
| `plan_marks` | Метки на планах |
| `plans_cache` | Кэш PDF-файлов |
| `sync_queue` | Очередь синхронизации (kind, attempts, nextAttemptAt) |
| `report_mutations` | Offline edit/delete с OCC (baseUpdatedAt) |
| `remote_reports_cache` | Снапшоты серверных отчётов для offline |
| `work_types_local` | Офлайн-созданные виды работ |
| `work_assignments_local` | Офлайн-созданные назначения работ |
| `photo_deletes` | Очередь удалений фото (offline) |
| `mark_updates` | Очередь правок меток (offline) |
| `catalogs` | Кэш справочников (projects, performers, work_types) |
| `device_settings` | Настройки устройства (retention policy) |
| `auth_session` | Refresh-токен (key='session', userId, email, refreshExpiresAt) |

## Синхронизация

### Sync loop (`src/services/sync.ts`)

- **Интервал:** 30с (активная вкладка) / 120с (фоновая)
- **Триггеры:** `online`, `visibilitychange`, ручная кнопка, `triggerSync()`
- **Порядок обработки:** work_type → report → mark → photo
- **Статусы:** `pending` → `syncing` → `synced` / `failed` / `blocked`
- **Backoff:** `min(60000, 2^attempts * 1000) + random(0..500)ms`
- **Классификация ошибок:**
  - `transient` (5xx, timeout) → retry с backoff
  - `auth` (401, JWT expired) → refresh token + retry
  - `blocked` (`DICT_CREATE_FORBIDDEN`, `DICT_INACTIVE`) → операция и черновик
    сохраняются, откладываются вместе со всеми зависимыми; отчёт получает статус
    `blocked` и sync-issue. Проверяется **раньше** статусных веток, иначе 403/409
    ушли бы в `permanent` с потерей данных
  - `permanent` (403, FK violation, validation) → mark failed

### Invalidation (`src/services/invalidation.ts`)

- **BroadcastChannel:** cross-tab синхронизация (`stroyfoto-invalidation`)
- **Polling fallback:** sync loop (30/120с) + `reconcile()` при `online`/`visibilitychange`
- **Серверный push (WS/SSE/LISTEN-NOTIFY):** не реализован — отдельный этап
- **Listeners:** `onReportsChanged`, `onReportChanged(id)`, `onCatalogsChanged`, `onPlansChanged`

### Reconcile (`src/services/reconcile.ts`)

Лёгкий pull после reconnect/visibility: загрузка metadata (без PDF/фото), обновление `remote_reports_cache`.

### Retention (`src/services/retention.ts`)

- Режимы: `all` (хранить всё), `from_date`, `none`
- Safeguard: **никогда** не удаляет unsynchronized данные
- Применяется после каждого sync цикла

## Маршруты

**Гостевые** (RequireGuest → редирект на /reports если auth):
- `/login`, `/register`

**Без guard'ов** (восстановление пароля):
- `/forgot-password`, `/reset-password` — намеренно доступны и залогиненному:
  забывший пароль обычно всё ещё держит живой refresh-токен, и `RequireGuest`
  отправил бы его на `/reports`, сделав ссылку «сломанной». Форма в настройках
  его тоже не спасает — ей нужен текущий пароль.

**Auth, без активации** (RequireAuth, allowInactive):
- `/pending-activation`

**Auth + Active** (RequireAuth + RequireActive):
- `/reports` — список отчётов
- `/reports/new` — создание отчёта (lazy)
- `/reports/:id` — детали отчёта (lazy)
- `/plans` — управление PDF-планами (lazy)
- `/settings` — настройки (lazy)

**Admin** (RequireAdmin):
- `/admin/users`, `/admin/projects`, `/admin/work-types`, `/admin/work-assignments`, `/admin/performers` (все lazy)

Guards: `src/app/router/guards.tsx`. Страницы: `src/app/router/routes.tsx`.

## Ключевые паттерны

### Offline-first

Все мутации (создание отчёта, edit, delete) сначала пишутся в IDB. UUID генерируется на клиенте → идемпотентность при retry. Отчёт в UI появляется мгновенно со статусом `pending`.

### OCC (Optimistic Concurrency Control)

Edit/delete отчётов используют `baseUpdatedAt` — если сервер вернул 0 rows, значит кто-то изменил отчёт раньше → ConflictError.

### Фото pipeline

1. Камера/галерея → `platform.camera`
2. Сжатие: max 1.5MB/2048px (main) + max 0.1MB/320px (thumb) — Web Worker
3. Сохранение в IDB (origin: 'local', syncStatus: 'pending_upload')
4. Sync: presigned PUT → Cloud.ru S3 (60с timeout) → upsert `report_photos`
5. Object keys: `photos/{reportId}/{photoId}.jpg`, `...-thumb.jpg`

### PDF pipeline

1. Админ/пользователь загружает PDF → Cloud.ru S3 (`plans/{projectId}/{planId}.pdf`)
2. При создании отчёта: выбор плана → скачивание (presigned GET) → IDB кэш
3. Рендер через pdfjs-dist на canvas → клик → normalized (xNorm, yNorm)
4. Offline: PDF из `plans_cache` в IDB

### Хранилище объектов (Cloud.ru S3)

- **Endpoint:** `https://s3.cloud.ru`, регион `ru-central-1`. Bucket
  приватный.
- **Подпись presigned URL** делает Fastify-роут `POST /api/storage/presign`
  через aws4fetch SigV4. accessKeyId формируется как `${tenant_id}:${key_id}`.
- **Авторизация на presign:** автор отчёта / член проекта / админ — для
  фото; член проекта / админ — для планов; PUT/DELETE дополнительно
  ограничены ролью.
- **Front никогда не видит S3-секреты:** `CLOUDRU_*` живут только в
  `server/.env`. Браузер ходит к `s3.cloud.ru` только по presigned URL,
  выпущенному backend'ом.
- **PWA SW кэш** (`vite.config.ts → runtimeCaching`) кэширует только
  `s3.cloud.ru` (CacheFirst, TTL 30 дней).

### Auth: хранение сессии

- Access-токен живёт только в памяти ([src/lib/apiClient.ts](src/lib/apiClient.ts)) — XSS-резистентность.
- Refresh-токен хранится в одном из двух режимов (`persistent` в записи сессии):
  - **`persistent: false`**: `sessionStorage` ключ `stroyfoto:auth_session` —
    сессия гасится при закрытии вкладки/окна.
  - **`persistent: true`** (текущий default логина и регистрации): IndexedDB
    store `auth_session` — автологин до `refreshExpiresAt` (30 дней).
  Чекбокса «Запомнить меня» в UI **нет**; механика режима сквозная и рабочая,
  так что добавить его — отдельная небольшая задача.
- На старте `restoreSession()` ([src/services/auth.ts](src/services/auth.ts))
  читает из любого источника (sessionStorage побеждает) и обменивает refresh
  на свежий access. Прозрачный refresh (`apiClient.tryRefresh`) сохраняет
  токен в тот же режим, в котором он лежал — session-only не «повышается»
  до персистентного.
- `signOut` чистит оба источника + сервер-side через `/api/auth/logout`.
  Возвращает `false`, если пользователь отменил подтверждение выхода.

**Все мутации сессии сериализованы** очередью в
[src/lib/authStorage.ts](src/lib/authStorage.ts), а проверка поколения
(`sessionEpoch`) делается внутри критической секции. Запись в IndexedDB
асинхронна, поэтому без очереди зависший `tryRefresh` мог бы завершиться
последним и затереть только что выданный токен. Установка access-токена
передаётся туда же коллбэком `commit`, чтобы refresh и access не могли
разъехаться по разным сессиям.

**Принятие сессии — только через `adoptSession`** из
[AuthProvider](src/app/providers/AuthProvider.tsx). Логин, регистрация и сброс
пароля возвращают сырой `SessionResponse` и сессию не применяют: решение
зависит от того, чьи локальные данные лежат на устройстве. `adoptSession`
**дожидается** `wipeAllUserData()` перед запуском синхронизации — wipe сносит
и несинхронизированные отчёты, и запускать sync параллельно с удалением нельзя.
Владелец данных берётся из `device_settings.last_user_id`, а не из текущей
сессии: после 401 сессии нет, а данные прежнего пользователя остались.

### Инвалидация сессий: `session_version`

Access-токен — stateless JWT, поэтому отзыв refresh-токенов сам по себе его не
гасит. `app_users.session_version` растёт при смене и сбросе пароля, JWT несёт
его в claim `sv`, а `authenticate` сравнивает и отвергает расхождение — чужая
вкладка получает 401 на первом же запросе, а не через `ACCESS_TOKEN_TTL`.
Проверка бесплатна: `loadUser` и так ходит в БД. Токены без claim трактуются
как поколение 0 (= DEFAULT колонки), поэтому выкладка никого не разлогинивает.

Выпуск токенов сериализован: `login` перечитывает пользователя под
`FOR UPDATE` и сверяет хэш (bcrypt считается вне блокировки), `register` и
смена пароля выпускают токен внутри своей транзакции, а `rotateRefreshToken`
проверяет `rowCount` отзыва старого токена и откатывается, если тот уже
погашен.

### Смена и сброс пароля

- **Смена**: `/settings` → «Безопасность» → `POST /api/profile/password`.
  Неверный текущий пароль — **400** `INVALID_CURRENT_PASSWORD`, а не 401:
  на 401 `apiFetch` запустил бы прозрачный refresh с ротацией токена.
- **Сброс** (почты в проекте нет, ссылку передаёт админ):
  1. `POST /api/auth/password-reset/request` — **всегда 202**, одинаково для
     известного и неизвестного адреса.
  2. Админ на `/admin/users` видит очередь и жмёт «Создать ссылку» →
     `POST /api/admin/password-resets` возвращает сырой токен **один раз**.
  3. Ссылка вида `/reset-password#token=…` — токен во **fragment**, поэтому не
     попадает ни в access-лог nginx, ни в `Referer`.
  4. `POST /api/auth/password-reset/check` — чистый SELECT, ссылку не
     расходует (иначе её погасило бы превью мессенджера).
  5. `POST /api/auth/password-reset/confirm` — 24 часа, один раз, выпуск новой
     ссылки гасит предыдущую.
- `/forgot-password` и `/reset-password` намеренно **вне `RequireGuest`**:
  забывший пароль обычно всё ещё держит живой refresh-токен, и guard отправил
  бы его на `/reports`.
- **Пароль: 6 символов минимум и не более 72 БАЙТ** — bcrypt молча игнорирует
  всё после 72 байт, поэтому длинный пароль отвергается, а не обрезается.
  Единая проверка — [passwordPolicy.ts](server/src/auth/passwordPolicy.ts) для
  register / change / reset.

### Темы

`ThemeProvider` → light/dark/system. Persist: `localStorage('stroyfoto:theme')`. Ant Design: `ConfigProvider` с `darkAlgorithm`/`defaultAlgorithm`. Meta `theme-color` обновляется динамически.

### Responsive layout

- `< 768px` → MobileLayout: header + drawer + bottom TabBar
- `≥ 768px` → DesktopLayout: collapsible Sider + header

### i18n

Все строки UI на русском в `src/shared/i18n/ru.ts`. Multi-language не поддерживается (MVP).

### Code splitting

Все тяжёлые страницы через `React.lazy`. Vendor chunks: `vendor-antd`, `vendor-pdfjs`, `vendor-360`, `vendor-idb`, `vendor-image`.

## Тесты

Vitest, два независимых конфига:

| Команда | Что гоняет |
|---|---|
| `npm run test:server` | интеграционные тесты API на живом PostgreSQL |
| `npm run test:client` | юниты фронтенда (jsdom, без сети и БД) |
| `npm test` | оба |

Тестовая БД поднимается отдельно и **обязана** быть одноразовой:

```bash
docker compose -f docker-compose.test.yml up -d   # PostgreSQL 17, как на проде
npm run test:db:setup                             # baseline + все миграции
npm test
```

`scripts/db/bootstrap-test-db.sh` отказывается работать, если имя БД не
оканчивается на `_test` или URL совпадает с `DATABASE_URL`: тесты делают
`TRUNCATE`, и цена ошибки в адресе — рабочие данные.

Роль baseline играет `database/stroyfoto.schema.sql` (он снят ДО существующих
миграций, поэтому они применяются обычным порядком). Скрипт **нормализует его
на лету**: генератор `export-schema.ts` раскладывает DDL по видам объектов, а
не по зависимостям, поэтому как есть снапшот не исполняется — FK едет раньше
PK своей таблицы, `CREATE TRIGGER` раньше `set_updated_at()`, а секция Indexes
дублирует индексы UNIQUE-констрейнтов. Сам файл авто-генерируемый и правится
только через `npm run db:schema:pull`.

Интеграционные тесты идут строго последовательно: они намеренно устраивают
гонки (двойное подтверждение ссылки, параллельная смена пароля, отмена против
подтверждения) и гоняют `TRUNCATE`.

## Ограничения MVP

- **Редактирование отчётов** — работает через EditReportModal + OCC, но только для автора и админа
- **Одна точка на плане на отчёт** — архитектура (`report_plan_marks`) готова к per-photo marks
- **Background Sync API не используется** — только in-app loop (generateSW без custom handler)
- **S3 timeout:** 60с PUT / 45с GET — медленные каналы → backoff retry
- **Справочники видов работ и назначений** пополняет только админ; офлайн-черновик обычного пользователя резолвится по имени, иначе отчёт уходит в `blocked` с ручной заменой позиции
- **Список отчётов без виртуализации** — до ~500 карточек
- **Сброс пароля — через администратора:** почтовой инфраструктуры нет, ссылку
  admin копирует и передаёт вне приложения. Самостоятельного восстановления по
  письму не будет, пока не появится SMTP
- **Вне scope MVP:** push-уведомления, комментарии, чат, дашборды, экспорт PDF/Excel, Capacitor shell

## Правила при внесении изменений

1. **Секреты:** никогда не класть JWT_SECRET или ключи Cloud.ru S3 в клиент. Все секреты — в `server/.env`. Из браузера к S3 — только через presigned URL от `POST /api/storage/presign`.
2. **Авторизация:** каждое ограничение доступа реализовать в Fastify-роуте через `authenticate` / `requireActiveUser` / `requireAdmin` middleware ([server/src/auth/](server/src/auth/)). RLS на стороне БД не используется — авторизация полностью в API-слое.
3. **Offline-first:** любая мутация сначала в IDB → sync в фоне. UI не должен блокироваться на сеть.
4. **Русский язык:** все пользовательские строки — в `src/shared/i18n/ru.ts` и на русском.
5. **Темы:** проверять что новый UI корректен и в light, и в dark теме.
6. **Mobile-first:** сначала мобильный layout, потом desktop.
7. **Зависимости:** не добавлять тяжёлые библиотеки без необходимости. Предпочитать browser API.
8. **IndexedDB:** при добавлении нового store — инкрементировать `DB_VERSION` в `src/lib/db.ts`.
9. **Типы:** strict TypeScript. Доменные типы — в `src/entities/`. Сервисные типы — рядом с сервисом.
10. **Структура БД:** изменения схемы — только миграциями в [db/migrations/](db/migrations/) (журнал `public.schema_migrations`, каждый файл применяется ровно один раз, правила — в [db/migrations/README.md](db/migrations/README.md)). Применение: `bash scripts/db/apply-migrations.sh --env-file server/.env`. Файлы [database/](database/) (`stroyfoto.schema.sql`, `.json`, `.md`) — **информационный** снапшот, перегенерируется через `npm run db:schema:pull`; исполнять его нельзя.
11. **Frontend → backend:** все запросы — через `apiFetch` из [src/lib/apiClient.ts](src/lib/apiClient.ts), который автоматически кладёт `Authorization: Bearer <access>` и делает transparent refresh по 401.
12. **Сессии:** принимать сессию только через `adoptSession` из [AuthProvider](src/app/providers/AuthProvider.tsx) — он дожидается очистки данных прежнего владельца устройства до старта sync. Мутации refresh-токена — только через [authStorage](src/lib/authStorage.ts), чтобы не обойти очередь и проверку поколения.
13. **Пароли:** любую новую точку задания пароля проводить через `validateNewPassword` ([passwordPolicy.ts](server/src/auth/passwordPolicy.ts)) и инкрементировать `app_users.session_version`, иначе старые access-токены переживут смену пароля. Выпуск refresh-токена требует явного `sessionVersion` — это проверяется компилятором.
14. **Конкурентность:** сценарии с гонками (двойной сабмит, параллельная смена пароля, отмена против подтверждения) покрывать интеграционными тестами в `server/test/` — руками они не воспроизводятся.
