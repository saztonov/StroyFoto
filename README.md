# СтройФото

Русскоязычное веб-приложение и PWA для фотоконтроля строительства: отчёты, планы, метки на чертежах. MVP, mobile-first, со светлой и тёмной темой.

## Стек

**Frontend**

- **Vite 6 + React 18 + TypeScript** (strict)
- **Ant Design 5** (локаль `ru_RU`, светлая/тёмная тема)
- **React Router v6** (`createBrowserRouter`)
- **vite-plugin-pwa** (`autoUpdate`, manifest + service worker, installable PWA)
- **IndexedDB** через `idb` v8 (offline-кэш, sync queue, retention)

**Backend**

- **Node 20 + Fastify 4** ([server/](server/))
- **Yandex Managed PostgreSQL** (миграции в [db/migrations/](db/migrations/))
- Собственный JWT: access-токен живёт в памяти браузера, refresh —
  в IndexedDB store `auth_session`; argon2id-хэш паролей на сервере
- **Cloud.ru Object Storage** (`s3.cloud.ru`, регион `ru-central-1`)
  для фото и PDF-планов; исторические объекты — в Cloudflare R2 до
  миграции
- **Presign**: `POST /api/storage/presign`
  ([server/src/routes/presign.ts](server/src/routes/presign.ts), SigV4
  через `aws4fetch`); секреты `CLOUDRU_*` / `R2_*` хранятся только в
  `server/.env` и не попадают в клиент

## Быстрый старт

```bash
# 1. Установить зависимости (фронт + бэк в одном package.json)
npm install

# 2. Скопировать пример env-файлов
cp .env.example .env                   # frontend (один VITE_API_URL)
cp server/.env.example server/.env     # backend (DB, JWT, CLOUDRU/R2 секреты)
# затем отредактировать server/.env под свои значения

# 3. Применить миграции БД (см. db/migrations/README.md)
#    npm-скрипт зависит от вашего деплоя; локально проще через psql:
psql "$DATABASE_URL" -f db/migrations/001_init.sql

# 4. Поднять frontend и backend параллельно
npm run dev:all
# vite → http://localhost:5173
# fastify → http://localhost:4000

# Только frontend:
npm run dev
# Только backend:
npm run server:dev
```

### Production

```bash
npm run build           # фронт: tsc -b && vite build → dist/
npm run server:build    # бэк: tsc -p server/tsconfig.json → server/dist/
npm run server:start    # node server/dist/server.js
npm run preview         # локальный предпросмотр собранного фронта
```

### Переменные окружения

**Frontend** (одна переменная):

| Переменная     | Назначение                                           | Default |
| -------------- | ---------------------------------------------------- | ------- |
| `VITE_API_URL` | Базовый URL backend API. Same-origin `/api` (prod через reverse proxy) или `http://localhost:4000/api` (dev). | `/api`  |

Валидация и нормализация — в [src/shared/config/env.ts](src/shared/config/env.ts).

**Backend** (`server/.env`) — см. `server/.env.example`. Минимальный
набор: `DATABASE_URL`, `JWT_SECRET`, `CLOUDRU_TENANT_ID`,
`CLOUDRU_KEY_ID`, `CLOUDRU_KEY_SECRET`, `CLOUDRU_BUCKET`,
`ALLOWED_ORIGINS`, и опционально `R2_*` на время миграции исторических
объектов.

## База данных

Миграции — в [db/migrations/](db/migrations/), нумерованные SQL-файлы
(`001_init.sql`, …). Применяются последовательно; в production — через
вашу любимую CI/CD-ленту или `psql`.

Что создаётся (см. `001_init.sql`):

- Расширения `pgcrypto`, `citext`.
- Enum-ы `user_role` (`admin` / `user`), `performer_kind`
  (`contractor` / `own_forces`).
- Таблицы: `users` (auth + profile в одной таблице — pwd_hash,
  full_name, role, is_active, …), `refresh_tokens`, `projects`,
  `project_memberships`, `work_types`, `work_assignments`, `performers`,
  `plans`, `reports`, `report_plan_marks`, `report_photos`.
- Триггер `set_updated_at` на `plans` / `users` / `projects` /
  `reports`.

Авторизация (admin/user, активация, доступ к проектам) реализована
в Fastify-роутах через `requireAuth` / `requireAdmin` /
`requireActiveUser` middleware ([server/src/auth/](server/src/auth/));
RLS на стороне БД не используется.

### Bootstrap первого администратора

После применения миграций:

1. Зарегистрируйтесь через UI (`/register`) — попадёте в `users`
   с `is_active=false`, `role='user'`.
2. В psql выполните:
   ```sql
   update users
   set role = 'admin', is_active = true
   where email = 'admin@example.com';
   ```
3. Перезайдите в приложение — будут доступны разделы `/admin/*`.

## Cloud.ru Object Storage

Bucket приватный. Фронт **никогда** не получает ключи: подпись
короткоживущих presigned URL делает Fastify-роут
`POST /api/storage/presign` ([server/src/routes/presign.ts](server/src/routes/presign.ts)),
бизнес-логика — в [server/src/services/presignService.ts](server/src/services/presignService.ts).

Cloud.ru Object Storage полностью S3-совместим: endpoint
`https://s3.cloud.ru`, регион `ru-central-1`, подпись AWS Signature V4.
Подробности — в [официальной документации](https://cloud.ru/docs/s3e/ug/topics/api__getting-started?source-platform=Evolution).

Схема:

```
Browser/PWA  ── POST /api/storage/presign ──►  Fastify
                                               verify JWT (own auth)
                                               проверка прав (membership/admin)
                                               SigV4 presign (aws4fetch)
                                               ◄─── { url, method, headers, expiresAt, provider }
Browser  ── PUT/GET ──►  https://s3.cloud.ru/<bucket>/...
```

Object keys (детерминированные, client-generated UUID):

```
photos/{reportId}/{photoId}.jpg
photos/{reportId}/{photoId}-thumb.jpg
plans/{projectId}/{planId}.pdf
```

### Получение ключей доступа Cloud.ru

1. В личном кабинете [cloud.ru](https://cloud.ru) включите Object
   Storage и создайте бакет (например `stroyfoto`).
2. Создайте сервисный ключ доступа (Key ID + Key Secret).
3. Возьмите идентификатор тенанта (показан над списком бакетов).
4. Настройте CORS на бакете (см. ниже).

> Cloud.ru использует составной accessKeyId формата
> `<tenant_id>:<key_id>` — backend собирает его автоматически из
> `CLOUDRU_TENANT_ID` и `CLOUDRU_KEY_ID`.

### CORS на бакете

В личном кабинете Cloud.ru → Permissions → CORS Rules:

| Поле               | Значение                                         |
| ------------------ | ------------------------------------------------ |
| Источники          | `https://stroyfoto.app`, `http://localhost:5173` |
| HTTP-методы        | `GET`, `PUT`, `DELETE`, `HEAD`                   |
| Заголовки запроса  | `*`                                              |
| Заголовки ответа   | `ETag`                                           |
| Время кэширования  | `3000`                                           |

### Перенос с Cloudflare R2 на Cloud.ru

Раньше файлы лежали в Cloudflare R2. У таблиц `report_photos` и `plans`
есть колонка `storage` со значениями `'r2'` (исторические объекты) или
`'cloudru'` (новые). Перенести можно двумя способами.

#### Вариант A: UI-миграция (`/admin/storage-migration`)

1. Зайдите администратором.
2. Откройте «Перенос на Cloud.ru».
3. Нажмите «Запустить» — для каждой строки с `storage='r2'` страница
   скачает файл из R2 (через presign с `provider:'r2'`, разрешён
   только админу) и зальёт в Cloud.ru с тем же object key, поменяв
   `storage` на `'cloudru'`.

Подходит для любых объёмов: миграция идёт построчно, идемпотентна,
безопасно перезапускается. Запускать имеет смысл из активной браузерной
вкладки (chrome/edge/firefox), желательно с десктопа — мобильный браузер
может усыпить таб.

После обнуления счётчика «Осталось переехать» секреты R2 на сервере
(`server/.env`) можно отозвать и удалить ветку `provider==='r2'` из
кода presign-сервиса.

## Структура проекта

```
src/
├── app/            # корневой App, провайдеры, router, layouts
│   ├── providers/  # ThemeProvider, AuthProvider
│   ├── router/     # routes.tsx, guards.tsx
│   └── layouts/    # AppShell, Desktop/Mobile/Auth layouts
├── pages/          # auth, reports, plans, settings, admin/*
├── entities/       # доменные типы (Profile, Project, WorkType, Performer)
├── shared/         # ui (SyncBanner, ThemeToggle), hooks, i18n, config
├── lib/
│   ├── apiClient.ts   # typed fetch wrapper + transparent refresh по 401
│   ├── authStorage.ts # refresh-token в IDB store auth_session
│   ├── db.ts          # IndexedDB схема (idb)
│   └── platform/      # CameraAdapter (точка расширения для Capacitor)
└── services/       # auth, sync, reconcile, photos, r2, plans, catalogs,
                    # localReports, retention, deviceSettings, storageQuota,
                    # invalidation, admin, storageMigration, reports/*

server/
├── src/
│   ├── server.ts        # bootstrap
│   ├── app.ts           # Fastify app + регистрация роутов
│   ├── db.ts            # pg.Pool
│   ├── config.ts        # env + zod
│   ├── auth/            # requireAuth, requireAdmin, JWT issue/verify
│   ├── routes/          # auth, profile, catalogs, reports, photos, plans,
│   │                    # presign, admin/*, authorNames, health
│   ├── services/        # presignService, и т.д.
│   ├── http/            # error mapping
│   └── access/          # авторизационные предикаты (membership и т.п.)
└── tsconfig.json

db/migrations/          # SQL-миграции Yandex MDB (001_init.sql, …)
scripts/db/             # apply-migrations.sh (npm run migrate:db)
scripts/migrate-db/     # Supabase → Yandex: export/import CSV + validate
```

## Маршруты frontend

Публичные (только для гостей):

- `/login` — вход
- `/register` — регистрация

Требует авторизацию, **не** требует активации:

- `/pending-activation` — экран ожидания активации

Требует авторизацию и активный профиль:

- `/reports` — список отчётов
- `/reports/new` — создание отчёта
- `/reports/:id` — детали отчёта
- `/plans` — планы PDF
- `/settings` — настройки

Только для администратора:

- `/admin/users`, `/admin/projects`, `/admin/work-types`,
  `/admin/work-assignments`, `/admin/performers`,
  `/admin/storage-migration`

Guard'ы — в [src/app/router/guards.tsx](src/app/router/guards.tsx).

## Темы

- `light`, `dark`, `system` (следует за `prefers-color-scheme`)
- Выбор хранится в `localStorage` (`stroyfoto:theme`)
- Переключение — в `/settings` и иконкой в шапке
- Реализовано через AntD `ConfigProvider` + `theme.defaultAlgorithm` /
  `darkAlgorithm`

## App shell

- Десктоп / планшет (`≥ 768px`) — `Sider` с меню + header (тема, выход).
- Мобильный (`< 768px`) — верхняя шапка с гамбургером (Drawer) и
  нижняя TabBar из 3 пунктов.
- Админские пункты показываются только при `profile.role === 'admin'`.

## PWA — поведение оффлайн

App shell, JS/CSS, иконки и PDF.js-воркер кэшируются Workbox'ом.
Дополнительно настроен `runtimeCaching`:

- **Изображения Cloud.ru S3 / R2** — `CacheFirst` (TTL 30 дней). Превью
  и фото уже просмотренных отчётов остаются доступны без сети. Шаблон
  URL покрывает `s3.cloud.ru` и `*.r2.cloudflarestorage.com` /
  `*.r2.dev`.
- **`/api/*` НЕ кэшируется через SW** — все офлайн-данные идут
  исключительно через явный IDB-кэш (`remote_reports_cache`,
  `catalogs`, `plans_cache`), которым управляет приложение.

Бизнес-данные (отчёты, фото, метки, черновики) живут в IndexedDB и не
зависят от SW-кэша. Любая операция сначала пишется локально, потом
фоновая очередь её отправляет.

## Синхронизация (offline-first)

- Все мутации (создание, edit, delete) сначала пишутся в IDB. UUID
  генерируется на клиенте → идемпотентность при retry.
- Очередь синхронизации со статусами `pending` / `syncing` / `synced` /
  `failed` / `pending_upload`, exponential backoff + jitter, ретраи
  ([src/services/sync.ts](src/services/sync.ts)).
- Триггеры синка: `online`, `visibilitychange`, ручная кнопка
  в SyncBanner, периодический интервал (30с активная вкладка / 120с
  скрытая — экономия батареи).
- Background Sync API не используется (vite-plugin-pwa в `generateSW`-
  режиме без кастомного handler'а).
- Cross-tab invalidation — через BroadcastChannel; серверный push
  (WebSocket / SSE / LISTEN-NOTIFY) пока не реализован, fallback —
  polling sync + `reconcile()` при `online` / `visibilitychange`
  ([src/services/invalidation.ts](src/services/invalidation.ts),
  [src/services/reconcile.ts](src/services/reconcile.ts)).

## Чеклист ручного тестирования перед релизом

Сборка и статический анализ:

- [ ] `npm run typecheck` — 0 ошибок
- [ ] `npm run build` — успешная сборка, без новых warnings
- [ ] `npm run preview` — `dist/` грузится без 404

Авторизация и роли:

- [ ] Регистрация → `/pending-activation`
- [ ] Вход неактивного → `/pending-activation`
- [ ] Админ активирует юзера в `/admin/users` → юзер видит `/reports`
- [ ] Logout → формы видны, профиль не мерцает
- [ ] Перезапуск браузера (Ctrl+R) — сессия восстанавливается через
      refresh-токен в IDB
- [ ] Доступ к закрытому endpoint'у с истёкшим access — transparent
      refresh, запрос проходит без UI-перебоев

Создание отчёта (online + offline):

- [ ] Юзер видит в селекте только свои проекты
- [ ] Создание отчёта с 3 фото с камеры (портрет + ландшафт): фото не
      повёрнуты, thumbnails корректны
- [ ] Ввод нового `work_type` в форме → появляется в справочнике
- [ ] PDF-план + клик → точка сохраняется
- [ ] DevTools → Network → Offline: создание работает, отчёт сразу
      в списке со статусом «Ожидает синхронизации»
- [ ] Включение сети → в течение 30 сек отчёт уходит на сервер,
      статус → `synced`

Безопасность:

- [ ] Прямой URL `/reports/:id` чужого проекта → «не найдено»
- [ ] Попытка вызвать `/api/profile` без Bearer → 401, frontend
      делает logout
- [ ] `POST /api/storage/presign` с `provider:'r2'` обычным юзером →
      403; админом → 200 (только GET; PUT в R2 запрещён всегда)

PWA:

- [ ] После build + preview: установка как PWA в Chrome, запуск
      standalone
- [ ] Service Worker регистрируется (DevTools → Application → SW)
- [ ] Offline → app shell грузится из кэша, ранее открытые отчёты
      и их фото видны

Темы и mobile UX:

- [ ] Переключение `light` ↔ `dark`: страницы читаемы,
      `<meta theme-color>` обновляется
- [ ] iPhone 12 / Pixel 7 device-mode: нижняя TabBar, drawer,
      safe-area-inset-bottom
- [ ] Admin-пункты в drawer видны только админу

Retention:

- [ ] `/settings` → «Хранить с даты» → старые synced-отчёты удаляются
      из IDB, pending — остаются
- [ ] `/settings` → «Не хранить локально» → после синка всё чистится,
      ни один pending/failed не пропадает

## Известные ограничения MVP

- Редактирование отчётов работает через `EditReportModal` + OCC
  (`baseUpdatedAt`), доступно автору и админу.
- Одна точка на плане на отчёт. `report_plan_marks` — отдельная
  таблица, готова к per-photo меткам в будущем.
- Список отчётов без виртуализации — комфортно до нескольких сотен
  карточек.
- Push-уведомления, экспорт PDF/Excel, комментарии, дашборды, чат —
  вне scope MVP.
- Capacitor-обёртка не подключена; `CameraAdapter` готов, реализация —
  только web.
- Серверный push (WebSocket / SSE) не реализован — invalidation
  работает через polling + BroadcastChannel.
- Гонка дубликатов `work_types` — два устройства офлайн с разными UUID
  для одного имени дадут одну запись (выигрывает первая через
  upsert-by-id, вторая помечается synced без записи; UI догонит после
  следующего `loadWorkTypes`).
- R2/S3 timeout — 60с PUT / 45с GET. Большие файлы на медленном канале
  ретраятся с backoff.

## Деплой

- **Frontend**: `npm run build` → `dist/` раздаётся любым статиком
  (Cloudflare Pages, Netlify, S3+CF). Требуется SPA-fallback на
  `index.html`.
- **Backend**: `npm run server:build` → `npm run server:start`. На
  проде — отдельная VM или контейнер; `server/.env` или secrets-store
  с `DATABASE_URL`, `JWT_SECRET`, `CLOUDRU_*`. Перед фронтом — reverse
  proxy, который проксирует `/api/*` на Fastify-инстанс.
- **БД**: применить миграции к Yandex MDB командой
  `DATABASE_URL=... npm run migrate:db`
  (эквивалент: `bash scripts/db/apply-migrations.sh`), затем bootstrap
  первого админа (см. выше).
- **Перенос объектов с R2**: страница `/admin/storage-migration` под
  админом — единственный способ.
