# СтройФото — руководство по кодовой базе

Русскоязычное PWA для фотоконтроля строительства. Статус: **рабочий MVP**.

## Стек

| Слой | Технология |
|------|-----------|
| Сборка | Vite 6 + TypeScript (strict) |
| UI | React 18 + Ant Design 5 (`ru_RU`) |
| Роутинг | React Router v6 (`createBrowserRouter`) |
| Backend | Supabase (Auth + Postgres + RLS + Realtime) |
| Файлы | Cloudflare R2 (приватный bucket) |
| Presign | Supabase Edge Function `sign` (aws4fetch SigV4) |
| Offline | IndexedDB (`idb` v8), sync queue, retention |
| PWA | vite-plugin-pwa (autoUpdate, Workbox) |
| Фото | browser-image-compression (Web Worker) |
| PDF | pdfjs-dist 5.6 |

Backend-API нет. Вся логика во фронтенде; R2-секреты хранятся только в Edge Function.

## Архитектура

```
Browser/PWA
  ├─ React UI (Ant Design)
  ├─ React Context: AuthProvider, ThemeProvider
  ├─ Сервисный слой (src/services/*)
  ├─ IndexedDB (10 stores, idb)
  │
  ├─► Supabase Auth (JWT)
  ├─► Supabase Postgres (RLS-защищённые таблицы)
  ├─► Supabase Realtime (postgres_changes → invalidation)
  ├─► Edge Function sign → presigned URL
  └─► Cloudflare R2 (PUT/GET фото и PDF)
```

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
│   ├── admin/        # UsersPage, ProjectsPage, WorkTypesPage, PerformersPage
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
│   ├── r2.ts             # Presigned URL запросы к Edge Function
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
│   └── config/env.ts # Валидация VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
├── lib/
│   ├── supabase.ts   # Клиент Supabase (persistSession, storageKey: stroyfoto:auth)
│   ├── db.ts         # IndexedDB: StroyFotoDB v84, 10 stores, getDB()
│   └── platform/     # Абстракция камеры (готова для Capacitor)
│       ├── index.ts
│       └── camera.ts # Web-реализация CameraAdapter
└── main.tsx          # Точка входа: dayjs ru, retention, PWA register

supabase/
├── schema.sql                # Единый SQL: таблицы, триггеры, RLS, RPC
├── migrations/
│   └── 20260412_realtime_and_batch_rpc.sql  # Realtime + get_author_names()
├── config.toml               # Supabase CLI config
└── functions/sign/index.ts   # Edge Function: presigned R2 URLs
```

## Модель данных

### Supabase (Postgres)

| Таблица | Назначение |
|---------|-----------|
| `profiles` | Профили (→ auth.users), role, is_active |
| `projects` | Проекты |
| `project_memberships` | Назначение пользователей на проекты |
| `work_types` | Виды работ (user-created поддерживается) |
| `performers` | Исполнители: kind = `contractor` / `own_forces` |
| `plans` | PDF-планы по проектам (r2_key, page_count) |
| `reports` | Отчёты (project, work_type, performer, plan, author) |
| `report_plan_marks` | Точки на плане (normalized xNorm/yNorm) |
| `report_photos` | Фотографии (r2_key, thumb_r2_key) |

**RPC-функции:** `admin_list_profiles()`, `get_author_name(uuid)`, `get_author_names(uuid[])` (batch).

**RLS-хелперы:** `is_admin()`, `is_active_user()` (security definer).

**Триггер:** `on_auth_user_created` → auto-create profile (is_active=false, role='user').

### IndexedDB (StroyFotoDB v84)

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
| `catalogs` | Кэш справочников (projects, performers, work_types) |
| `device_settings` | Настройки устройства (retention policy) |

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

- **Supabase Realtime:** подписка на postgres_changes по 8 таблицам
- **BroadcastChannel:** cross-tab синхронизация (`stroyfoto-invalidation`)
- **Listeners:** `onReportsChanged`, `onCatalogsChanged`, `onPlansChanged`

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
- `/admin/users`, `/admin/projects`, `/admin/work-types`, `/admin/performers` (все lazy)

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
4. Sync: presigned PUT → R2 (60с timeout) → upsert `report_photos`
5. R2 keys: `photos/{reportId}/{photoId}.jpg`, `...-thumb.jpg`

### PDF pipeline

1. Админ/пользователь загружает PDF → R2 (`plans/{projectId}/{planId}.pdf`)
2. При создании отчёта: выбор плана → скачивание (presigned GET) → IDB кэш
3. Рендер через pdfjs-dist на canvas → клик → normalized (xNorm, yNorm)
4. Offline: PDF из `plans_cache` в IDB

### Темы

`ThemeProvider` → light/dark/system. Persist: `localStorage('stroyfoto:theme')`. Ant Design: `ConfigProvider` с `darkAlgorithm`/`defaultAlgorithm`. Meta `theme-color` обновляется динамически.

### Responsive layout

- `< 768px` → MobileLayout: header + drawer + bottom TabBar
- `≥ 768px` → DesktopLayout: collapsible Sider + header

### i18n

Все строки UI на русском в `src/shared/i18n/ru.ts`. Multi-language не поддерживается (MVP).

### Code splitting

Все тяжёлые страницы через `React.lazy`. Vendor chunks: `vendor-antd`, `vendor-pdfjs`, `vendor-supabase`, `vendor-idb`, `vendor-image`.

## Ограничения MVP

- **Редактирование отчётов** — работает через EditReportModal + OCC, но только для автора и админа
- **Одна точка на плане на отчёт** — архитектура (`report_plan_marks`) готова к per-photo marks
- **Background Sync API не используется** — только in-app loop (generateSW без custom handler)
- **R2 timeout:** 60с PUT / 45с GET — медленные каналы → backoff retry
- **Дубли work_types** при офлайн-создании — дедупликация по citext unique name
- **Список отчётов без виртуализации** — до ~500 карточек
- **Вне scope MVP:** push-уведомления, комментарии, чат, дашборды, экспорт PDF/Excel, Capacitor shell

## Правила при внесении изменений

1. **Секреты:** никогда не класть service_role key или R2-секреты в клиент. Только presigned URL через Edge Function.
2. **RLS:** каждое ограничение доступа дублировать в RLS-политиках (`supabase/schema.sql`).
3. **Offline-first:** любая мутация сначала в IDB → sync в фоне. UI не должен блокироваться на сеть.
4. **Русский язык:** все пользовательские строки — в `src/shared/i18n/ru.ts` и на русском.
5. **Темы:** проверять что новый UI корректен и в light, и в dark теме.
6. **Mobile-first:** сначала мобильный layout, потом desktop.
7. **Зависимости:** не добавлять тяжёлые библиотеки без необходимости. Предпочитать browser API.
8. **IndexedDB:** при добавлении нового store — инкрементировать `DB_VERSION` в `src/lib/db.ts`.
9. **Типы:** strict TypeScript. Доменные типы — в `src/entities/`. Сервисные типы — рядом с сервисом.
10. **Миграции:** инкрементальные SQL в `supabase/migrations/`. Основная схема — `supabase/schema.sql`.
