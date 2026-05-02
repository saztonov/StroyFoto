# СтройФото — руководство по кодовой базе

Русскоязычное PWA для фотоконтроля строительства. Статус: **рабочий MVP**.

## Стек

| Слой | Технология |
|------|-----------|
| Сборка | Vite 6 + TypeScript (strict) |
| UI | React 18 + Ant Design 5 (`ru_RU`) |
| Роутинг | React Router v6 (`createBrowserRouter`) |
| Backend | Node 20 + Fastify 4 (`server/`) |
| БД | Yandex Managed PostgreSQL (миграции в `db/migrations/`) |
| Auth | Собственный JWT: access в памяти браузера, refresh в IDB store `auth_session`; argon2id-хэш паролей на сервере |
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
  ├─ IndexedDB (11 stores, idb)
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
│   ├── localReports.ts   # IDB-операции над черновиками
│   ├── photos.ts         # Сжатие, IDB-хранение, статусы
│   ├── plans.ts          # Скачивание PDF, IDB-кэш
│   ├── objectStorage.ts  # Presigned URL к Cloud.ru S3 + put/get/timeout
│   ├── catalogs.ts       # Загрузка справочников + IDB-кэш
│   ├── retention.ts      # Очистка старых данных по настройке
│   ├── deviceSettings.ts # Настройки устройства в IDB
│   ├── storageQuota.ts   # Мониторинг квоты IndexedDB
│   ├── admin.ts          # Админские операции
│   └── auth.ts           # signUp, login, signOut, loadProfile
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
│   ├── authStorage.ts# Refresh-token в IDB store auth_session
│   ├── db.ts         # IndexedDB: StroyFotoDB v88, 11 stores, getDB()
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
│   ├── auth/         # requireAuth, requireAdmin, JWT issue/verify
│   ├── routes/       # auth, profile, catalogs, reports, photos, plans,
│   │                 # presign, admin/*, authorNames, health
│   ├── services/     # presignService и др.
│   ├── http/         # error mapping
│   └── access/       # authz-предикаты (membership и т.п.)
└── tsconfig.json

db/migrations/        # Нумерованные SQL для Yandex MDB
                      # 001_init.sql, 002_auth_refresh_tokens.sql,
                      # 003_cloudru_only_object_keys.sql
scripts/db/           # apply-migrations.sh (npm run migrate:db)
```

## Модель данных

### Серверная схема (Postgres)

| Таблица | Назначение |
|---------|-----------|
| `app_users` / `profiles` | Auth + профиль (1:1 по id): email, password_hash (argon2id), full_name, role, is_active |
| `refresh_tokens` | Активные refresh-сессии (rotation, expires_at) |
| `projects` | Проекты |
| `project_memberships` | Назначение пользователей на проекты |
| `work_types` | Виды работ (user-created поддерживается) |
| `work_assignments` | Назначения работ |
| `performers` | Исполнители: kind = `contractor` / `own_forces` |
| `plans` | PDF-планы по проектам (object_key, page_count) |
| `reports` | Отчёты (project, work_type, performer, plan, author) |
| `report_plan_marks` | Точки на плане (normalized xNorm/yNorm) |
| `report_photos` | Фотографии (object_key, thumb_object_key) |

> Бинарные объекты (фото, PDF-планы) лежат в Cloud.ru Object Storage;
> в БД хранятся только `object_key` и `thumb_object_key` — детерминированные
> ключи, сгенерированные клиентом (`photos/{reportId}/{photoId}.jpg`,
> `plans/{projectId}/{planId}.pdf`).

**Авторизация** реализована в Fastify-роутах через middleware
`requireAuth` / `requireAdmin` / `requireActiveUser`
([server/src/auth/](server/src/auth/)); `pool.query` без request-bound
claims. RLS на стороне БД не используется.

### IndexedDB (StroyFotoDB v88)

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
- **Статусы:** `pending` → `syncing` → `synced` / `failed`
- **Backoff:** `min(60000, 2^attempts * 1000) + random(0..500)ms`
- **Классификация ошибок:**
  - `transient` (5xx, timeout) → retry с backoff
  - `auth` (401, JWT expired) → refresh token + retry
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

### Темы

`ThemeProvider` → light/dark/system. Persist: `localStorage('stroyfoto:theme')`. Ant Design: `ConfigProvider` с `darkAlgorithm`/`defaultAlgorithm`. Meta `theme-color` обновляется динамически.

### Responsive layout

- `< 768px` → MobileLayout: header + drawer + bottom TabBar
- `≥ 768px` → DesktopLayout: collapsible Sider + header

### i18n

Все строки UI на русском в `src/shared/i18n/ru.ts`. Multi-language не поддерживается (MVP).

### Code splitting

Все тяжёлые страницы через `React.lazy`. Vendor chunks: `vendor-antd`, `vendor-pdfjs`, `vendor-360`, `vendor-idb`, `vendor-image`.

## Ограничения MVP

- **Редактирование отчётов** — работает через EditReportModal + OCC, но только для автора и админа
- **Одна точка на плане на отчёт** — архитектура (`report_plan_marks`) готова к per-photo marks
- **Background Sync API не используется** — только in-app loop (generateSW без custom handler)
- **S3 timeout:** 60с PUT / 45с GET — медленные каналы → backoff retry
- **Дубли work_types** при офлайн-создании — дедупликация по citext unique name
- **Список отчётов без виртуализации** — до ~500 карточек
- **Вне scope MVP:** push-уведомления, комментарии, чат, дашборды, экспорт PDF/Excel, Capacitor shell

## Правила при внесении изменений

1. **Секреты:** никогда не класть JWT_SECRET или ключи Cloud.ru S3 в клиент. Все секреты — в `server/.env`. Из браузера к S3 — только через presigned URL от `POST /api/storage/presign`.
2. **Авторизация:** каждое ограничение доступа реализовать в Fastify-роуте через `requireAuth` / `requireAdmin` / `requireActiveUser` middleware ([server/src/auth/](server/src/auth/)). RLS на стороне БД не используется — авторизация полностью в API-слое.
3. **Offline-first:** любая мутация сначала в IDB → sync в фоне. UI не должен блокироваться на сеть.
4. **Русский язык:** все пользовательские строки — в `src/shared/i18n/ru.ts` и на русском.
5. **Темы:** проверять что новый UI корректен и в light, и в dark теме.
6. **Mobile-first:** сначала мобильный layout, потом desktop.
7. **Зависимости:** не добавлять тяжёлые библиотеки без необходимости. Предпочитать browser API.
8. **IndexedDB:** при добавлении нового store — инкрементировать `DB_VERSION` в `src/lib/db.ts`.
9. **Типы:** strict TypeScript. Доменные типы — в `src/entities/`. Сервисные типы — рядом с сервисом.
10. **Миграции БД:** новые SQL — в `db/migrations/` нумерованным файлом (`004_*.sql`, `005_*.sql`, …); применять последовательно.
11. **Frontend → backend:** все запросы — через `apiFetch` из [src/lib/apiClient.ts](src/lib/apiClient.ts), который автоматически кладёт `Authorization: Bearer <access>` и делает transparent refresh по 401.
