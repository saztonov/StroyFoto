# СтройФото

Русскоязычное веб-приложение и PWA для фотоконтроля строительства: отчёты, планы, метки на чертежах. MVP, mobile-first, со светлой и тёмной темой.

## Стек

- **Vite + React 18 + TypeScript**
- **Ant Design 5** (локаль `ru_RU`, светлая/тёмная тема)
- **React Router v6** (`createBrowserRouter`)
- **Supabase** (Auth + Postgres, напрямую из браузера)
- **vite-plugin-pwa** (manifest + service worker, installable PWA)

Отдельного backend-API нет. Вся логика во фронтенде; файлы лежат в приватном Cloudflare R2, а короткоживущие presigned URL выдаёт Supabase Edge Function [supabase/functions/sign/](supabase/functions/sign/). Все R2-секреты хранятся в Supabase и никогда не попадают в клиент.

## Быстрый старт

```bash
# 1. Установить зависимости
npm install

# 2. Скопировать пример переменных окружения и заполнить своими ключами Supabase
cp .env.example .env
# затем отредактировать .env

# 3. Запустить dev-сервер
npm run dev
# → http://localhost:5173

# 4. Сборка production
npm run build

# 5. Локальный предпросмотр production-сборки
npm run preview
```

### Переменные окружения

| Переменная               | Назначение                   | Обязательна |
| ------------------------ | ---------------------------- | ----------- |
| `VITE_SUPABASE_URL`      | URL проекта Supabase         | да          |
| `VITE_SUPABASE_ANON_KEY` | Публичный anon-ключ Supabase | да          |

Валидация в [src/shared/config/env.ts](src/shared/config/env.ts). Для R2
никаких дополнительных `VITE_*`-переменных не нужно: URL Edge Function
`sign` собирается из `VITE_SUPABASE_URL` внутри
`supabase.functions.invoke`, а все R2-секреты хранятся в Supabase
(см. секцию «Cloudflare R2 signer»).

`.env.production` уже содержит публичные ключи для staging-проекта Supabase
и коммитится в репозиторий намеренно (anon-ключ публичный по дизайну).

## Supabase setup

Вся схема БД лежит в одном идемпотентном скрипте
[supabase/schema.sql](supabase/schema.sql) — это единственный SQL-артефакт,
который нужно применить на свежем Supabase-проекте. Файл написан через
`create ... if not exists` / `drop policy if exists ... create policy ...`,
поэтому безопасно запускать повторно после правок RLS без пересоздания базы.

### Применение

Откройте Supabase Dashboard → SQL Editor → New query, вставьте содержимое
`supabase/schema.sql` целиком и выполните. Всё создастся одной транзакцией.

Альтернатива — через CLI:

```bash
supabase link --project-ref <your-project-ref>
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

### Что создаётся

- Расширения `pgcrypto`, `citext`.
- Enum-ы `user_role` (`admin`/`user`), `performer_kind` (`contractor`/`own_forces`).
- Таблицы: `profiles`, `projects`, `project_memberships`, `work_types`, `performers`, `plans`, `reports`, `report_plan_marks`, `report_photos`.
- Триггер `on_auth_user_created` на `auth.users` — автоматически создаёт строку в `profiles` при регистрации (`is_active=false`, `role='user'`).
- Хелперы для RLS: `public.is_admin()`, `public.is_active_user()` (`security definer`, без рекурсии).
- Полный набор RLS-политик (секция 7 `schema.sql`).
- RPC `public.admin_list_profiles()` — список пользователей с email из `auth.users` для админки.
- RPC `public.get_author_name(uuid)` — минимально-раскрытое имя автора чужого отчёта, чтобы не ослаблять RLS на `profiles`.

### Bootstrap первого администратора

После применения миграций:

1. Зарегистрируйтесь через UI (`/register`) — пользователь создастся в `auth.users`, а в `public.profiles` появится строка с `is_active=false`.
2. Откройте Supabase SQL Editor и выполните, подставив свой email:

```sql
update public.profiles
set role = 'admin', is_active = true
where id = (select id from auth.users where email = 'admin@example.com');
```

3. Перезайдите в приложение — теперь доступны разделы `/admin/*`. Дальнейших администраторов и активацию обычных пользователей делаете уже через UI админки.

### Ключевые правила RLS

- **profiles** — пользователь видит свою строку и может править только `full_name`; админ видит и меняет всё. Имя автора чужого отчёта вытаскивается через `get_author_name()` RPC.
- **projects / plans / project_memberships** — требуется активный (`is_active_user()`) пользователь, который состоит в проекте. Деактивированные пользователи с residual membership ничего не видят. CRUD только у админа.
- **work_types** — любой активный пользователь читает и может вставить новый (для авто-добавления из формы отчёта); update/delete только у админа.
- **performers** — читает любой активный пользователь; пишет только админ.
- **reports** — читать может админ или активный пользователь, состоящий в проекте; вставка только если `author_id = auth.uid()`, пользователь состоит в `project_id`, **и** `plan_id` (если задан) принадлежит тому же проекту; редактирование/удаление — только админ (MVP).
- **report_plan_marks / report_photos** — доступ наследуется от родительского отчёта; вставка разрешена автору отчёта. Для `report_plan_marks` дополнительно проверяется, что `plan_id` принадлежит проекту этого отчёта (защита от подмены плана).

## Cloudflare R2 signer

Bucket R2 приватный. Фронтенд **никогда** не получает ни service_role
Supabase, ни ключи R2 — подпись короткоживущих presigned URL делает
**Supabase Edge Function** [supabase/functions/sign/](supabase/functions/sign/).
Отдельный Cloudflare Worker больше не нужен.

Схема:

```
Browser/PWA  ── supabase.functions.invoke('sign') ──►  Edge Function sign
                                                        verify JWT (Supabase Gateway)
                                                        supabase.auth.getUser()
                                                        RLS-проверки через supabase-js
                                                        SigV4 presign (aws4fetch)
                                                        ◄─── { url, method, headers, expiresAt }
Browser  ── PUT/GET ──►  Cloudflare R2 (приватный bucket)
```

Object keys (детерминированные, client-generated UUID):

```
photos/{reportId}/{photoId}.jpg
photos/{reportId}/{photoId}-thumb.jpg
plans/{projectId}/{planId}.pdf
```

### Деплой Edge Function

```bash
# 1. Залогиниться в Supabase CLI и привязать проект
supabase login
supabase link --project-ref <your-project-ref>

# 2. Положить секреты R2 (один раз). SUPABASE_URL / SUPABASE_ANON_KEY
#    задавать НЕ нужно — их Supabase инжектит сам. Префикс SUPABASE_
#    зарезервирован.
supabase secrets set \
  R2_ACCOUNT_ID=xxxxxxxx \
  R2_ACCESS_KEY_ID=xxxxxxxx \
  R2_SECRET_ACCESS_KEY=xxxxxxxx \
  R2_BUCKET=stroyfoto \
  ALLOWED_ORIGINS=https://stroyfoto.app,http://localhost:5173

# 3. Задеплоить функцию
supabase functions deploy sign
```

После этого клиент автоматически начнёт ходить в
`${VITE_SUPABASE_URL}/functions/v1/sign` — дополнительной настройки не
требуется.

### Локальный запуск функции

```bash
supabase functions serve sign
# + в ./supabase/.env.local положить R2_* и ALLOWED_ORIGINS
```

### CORS на R2

CORS на R2 bucket настройте на тот же origin фронтенда (для PUT/GET
напрямую в `*.r2.cloudflarestorage.com` из браузера). Минимальный
пример правил R2 CORS:

```json
[
  {
    "AllowedOrigins": ["https://stroyfoto.app", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## Структура проекта

```
src/
├── app/            # корневой App, провайдеры, router, layouts
│   ├── providers/  # ThemeProvider, AuthProvider
│   ├── router/     # routes.tsx, guards.tsx
│   └── layouts/    # AppShell, Desktop/Mobile/Auth layouts
├── pages/          # страницы (auth, reports, plans, settings, admin)
├── entities/       # доменные типы (Profile, Project, WorkType, Performer)
├── shared/         # ui (SyncBanner, ThemeToggle), hooks, i18n, config
├── lib/            # интеграции: supabase.ts, db.ts (IndexedDB), platform/ (CameraAdapter)
└── services/       # auth, sync, photos, localReports, retention, r2, catalogs, deviceSettings
supabase/
├── schema.sql       # единый SQL-скрипт: схема, триггеры, RLS, RPC
├── config.toml      # конфиг Supabase CLI (секция [functions.sign])
└── functions/sign/  # Edge Function: presigned R2 URLs (SigV4 через aws4fetch)
```

## Маршруты

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
- `/settings` — настройки (переключение темы)

Только для администратора:
- `/admin/users` — пользователи
- `/admin/projects` — проекты
- `/admin/work-types` — виды работ
- `/admin/performers` — подрядчики и собственные силы

Guard'ы (`src/app/router/guards.tsx`):
- `RequireGuest` — пускает только неавторизованных
- `RequireAuth` — требует сессию; неактивных отправляет на `/pending-activation`
- `RequireActive` — страховка на активный профиль
- `RequireAdmin` — требует `profile.role === 'admin'`

Профиль берётся из таблицы `profiles` Supabase. Если записи ещё нет (миграции не применены) — каркас трактует пользователя как неактивного и отправляет на `/pending-activation`, не падая.

## Темы

- `light`, `dark`, `system` (следует за `prefers-color-scheme`)
- Выбор хранится в `localStorage` (`stroyfoto:theme`)
- Переключение доступно в `/settings` и иконкой в шапке
- Реализовано через AntD `ConfigProvider` + `theme.defaultAlgorithm` / `darkAlgorithm`

## App shell

- На десктопе / планшете (`≥768px`) — `Sider` с меню + header с переключателем темы и выходом.
- На мобильном (`<768px`) — верхняя шапка с заголовком раздела и гамбургером (Drawer со всеми пунктами) + нижняя TabBar из 3 пунктов.
- Администраторские пункты показываются только если `profile.role === 'admin'`.

## PWA

- Манифест сгенерирован плагином `vite-plugin-pwa` (`autoUpdate`).
- Локаль `ru`, `display: standalone`, `theme_color: #1677ff`.
- Иконки `192 / 512 / 512-maskable` — в `public/icons/` (placeholder «С» на синем фоне). Генерируются скриптом `scripts/gen-icons.mjs`:
  ```bash
  node scripts/gen-icons.mjs
  ```
- После `npm run build` в `dist/` появляются `sw.js` и `manifest.webmanifest`; установка как PWA доступна из Chrome / Edge / Safari iOS.

## Что уже реально работает

- Сборка (`tsc -b && vite build`), installable PWA: manifest + service worker (`autoUpdate`), iOS meta-теги, raster иконки 192/512/maskable, apple-touch-icon, theme-color для светлой и тёмной темы.
- Маршрутизация и все 4 guard'а; тяжёлые страницы загружаются как отдельные чанки через `React.lazy + Suspense` (`src/app/router/routes.tsx`).
- Вход, регистрация, выход через Supabase Auth; экран ожидания активации.
- Полный набор админских CRUD: пользователи, проекты, виды работ, исполнители (см. `src/pages/admin/*`).
- Создание отчётов с фото (камера/галерея), PDF-плеер для планов, точка на плане, выбор плана и страницы.
- Сжатие фото на клиенте через `browser-image-compression` (web worker), thumbnail для превью, последовательная обработка чтобы не душить мобильный CPU.
- Локальное хранилище: IndexedDB через `idb` (`src/lib/db.ts`); все черновики, фото и метки сначала пишутся локально и мгновенно отображаются в UI.
- Очередь синхронизации со статусами `pending / syncing / failed / synced / pending_upload`, exponential backoff + jitter, ретраи, идемпотентность по UUID (`src/services/sync.ts`). Отчёт считается `synced` **только** когда агрегированно завершены все связанные задачи (report + mark + photo + work_type) — не раньше.
- Триггеры синхронизации: появление сети (`online`), возврат вкладки в фокус (`visibilitychange`), ручная кнопка в баннере, периодический интервал (30с активная вкладка / 120с скрытая — экономия батареи). Background Sync API **не** используется: `vite-plugin-pwa` работает в `generateSW`-режиме без кастомного SW-handler'а, поэтому приложение честно полагается только на in-app fallback.
- Глобальный SyncBanner: офлайн / синхронизация / pending count / failed count + кнопка «Повторить»; Badge с числом ожидающих отчётов на иконке «Отчёты» в нижней навигации.
- Адаптивный layout: mobile-first с нижней tabbar и Drawer'ом, планшет/десктоп получают Sider (breakpoint `md`/768px), карточки отчётов в responsive Row/Col grid.
- Светлая / тёмная / системная тема с persist в `localStorage`, синхронизация `<meta name="theme-color">` для обоих media-query вариантов.
- Управление локальным хранением истории в `/settings`: «не хранить локально» / «хранить начиная с даты» — несинхронизированные отчёты никогда не удаляются (`src/services/retention.ts`).
- Тонкая платформенная абстракция `src/lib/platform/` (camera adapter) — точка расширения для будущей Capacitor-обёртки без переписывания UI.
- Редактирование и удаление отчётов через `EditReportModal` с OCC (optimistic concurrency control через `baseUpdatedAt`). Offline edit/delete ставятся в IDB-очередь `report_mutations` и синхронизируются автоматически.
- Многопользовательская синхронизация через Supabase Realtime (postgres_changes по 8 таблицам) + BroadcastChannel для cross-tab invalidation.
- Батчевый RPC `get_author_names(uuid[])` для загрузки имён авторов без N+1.

## Известные ограничения MVP

- **Редактирование отчёта** после синхронизации поддерживается через
  `EditReportModal` с оптимистичным concurrency control (OCC): перед
  отправкой фиксируется `updated_at`, сервер проверяет что строка не
  изменилась другим пользователем. Удаление доступно автору и админу.
  Offline-edit/delete ставятся в очередь `report_mutations` в IndexedDB
  и синхронизируются при появлении сети.
- **Одна точка на плане на весь отчёт**. Архитектура (`report_plan_marks`
  как отдельная таблица, нормализованные координаты) готова к будущей
  привязке точки к каждому фото — в MVP сознательно не реализовано.
- **Список отчётов без виртуализации** — комфортно до нескольких сотен
  карточек. При росте объёма стоит добавить `react-window`.
- **Push-уведомления, экспорт в PDF/Excel, комментарии, дашборды, чат** —
  вне scope MVP.
- **Capacitor/нативный shell** ещё не подключён: интерфейс `CameraAdapter`
  (`src/lib/platform/`) готов, но реализация — только web. Будущая
  Android-обёртка не потребует переписывать UI.
- **Background Sync API — не используется.** В `generateSW`-режиме кастомный
  SW-handler не подключается, поэтому ретраи идут только через in-app loop
  (online-событие, visibilitychange, interval). Это сознательное MVP-решение,
  чтобы не тащить `injectManifest` ради одного эффекта.
- **R2 PUT timeout** — 60 сек на фото, 45 сек на GET. Очень большие файлы
  на медленном канале будут ретраиться с экспоненциальным backoff.
- **Гонка дубликатов `work_types`** — если два устройства офлайн создали
  один и тот же новый вид работ с разными UUID, после синка в БД останутся
  обе записи (unique только по `name` через citext, но client UUID разные).
  Первая вставка выиграет через upsert-by-id, вторая упадёт по unique-name
  и будет помечена synced без записи. Дубль в UI исчезнет после следующего
  `loadWorkTypes`.
- **Удаление справочников** — FK с `on delete restrict` защитит от ломки
  данных, но UX-сообщение об отказе в админке будет сырым (показывается
  стандартный текст ошибки PostgreSQL).
- **Исторические данные в офлайне** — сохраняются в IDB store
  `remote_reports_cache` при онлайн-просмотре списка/деталей. Первая
  загрузка отчёта, которого нет локально, требует сети; на втором заходе
  тот же отчёт (включая фото) открывается офлайн.

## Чеклист ручного тестирования перед релизом

Сборка и статический анализ:

- [ ] `npm run typecheck` — 0 ошибок
- [ ] `npm run build` — успешная сборка, без новых warnings
- [ ] `npm run preview` запускает собранный `dist/` и он грузится без 404

Авторизация и роли:

- [ ] Регистрация нового пользователя через `/register` → редирект на
      `/pending-activation`
- [ ] Вход неактивного пользователя → снова `/pending-activation`
- [ ] Админ (через SQL bootstrap) активирует юзера в `/admin/users` →
      юзер перезаходит → видит `/reports`
- [ ] Logout → forms auth снова видны, профиль не мерцает
- [ ] Logout в одной вкладке → вторая вкладка реагирует на
      `onAuthStateChange` и уходит на `/login`
- [ ] Быстрый двойной логин двумя разными пользователями подряд —
      финальный профиль в UI соответствует последнему user.id (проверка
      фикса гонки в `AuthProvider`)

Админские разделы:

- [ ] Админ создаёт проект в `/admin/projects`
- [ ] Админ назначает обычному юзеру membership в проекте
- [ ] Админ создаёт `work_type` и `performer` обоих типов
      (`contractor` / `own_forces`)
- [ ] Админ меняет ФИО и роль пользователю

Создание отчёта (online):

- [ ] Обычный юзер видит в селекте только свои проекты
- [ ] Создание отчёта с 3 фото с камеры мобильного (портрет + ландшафт):
      фото не повёрнуты, thumbnail-ы корректны
- [ ] Ввод несуществующего `work_type` в форме → появляется в справочнике
- [ ] Выбор PDF-плана, страницы, клик на плане → точка сохраняется
- [ ] Отчёт сразу появляется в `/reports` после сохранения

Офлайн и синхронизация:

- [ ] DevTools → Network → Offline: создание отчёта работает, отчёт
      сразу в списке со статусом «Ожидает синхронизации»
- [ ] SyncBanner показывает «Оффлайн» и pending count
- [ ] Включение сети → в течение 30 сек отчёт уходит на сервер,
      статус → `synced`, badge с числом обновляется
- [ ] В IndexedDB (`Application` → IndexedDB → `stroyfoto` → `sync_queue`)
      не остаётся дубликатов после двойного клика «Сохранить»
      (проверка дедупа)
- [ ] Ручная кнопка «Повторить» в банере не плодит дубликаты в
      Supabase (проверить `select count(*) from reports where id = '...'`)
- [ ] Отключение сети посреди загрузки фото (DevTools → Network →
      Slow 3G + Offline через 5 сек) — сессия не зависает дольше 60 сек,
      op уходит в backoff
- [ ] Переоткрытие вкладки (`visibilitychange`) триггерит синк

Безопасность и RLS:

- [ ] Обычный юзер вводит прямой URL `/reports/:id` чужого проекта —
      видит «не найдено», а не данные
- [ ] В Supabase SQL Editor: `select * from reports;` под анонимным
      ключом → 0 строк (RLS работает)
- [ ] Попытка отредактировать `profile.role` из фронта (через
      supabase-js) → отказ RLS

PWA и офлайн shell:

- [ ] После `npm run build` + `npm run preview`: в Chrome → установка
      как PWA, запуск в standalone
- [ ] Service Worker регистрируется (DevTools → Application → SW)
- [ ] Выключение сети → app shell грузится из кэша, ранее открытые
      отчёты видны

Темы и mobile UX:

- [ ] Переключение `light` ↔ `dark` в `/settings` и в шапке — все
      страницы читаемы, `<meta theme-color>` переключается, нет
      белых вспышек при загрузке
- [ ] DevTools → Device Mode (iPhone 12, Pixel 7): нижняя TabBar,
      drawer с гамбургером, safe-area-inset-bottom уважается
- [ ] Admin-пункты в мобильном drawer видны только админу

Retention (локальное хранение):

- [ ] `/settings` → «Хранить с даты» → старые synced-отчёты удаляются
      из IndexedDB, pending — остаются
- [ ] `/settings` → «Не хранить историю локально» → после синка
      всё чистится, но ни один pending/failed отчёт не пропадает

Edge Function `sign` (R2 signer):

- [ ] `supabase functions deploy sign` прошёл без ошибок, секреты
      `R2_*` заданы через `supabase secrets set`
- [ ] Фронт на dev-сервере успешно получает presigned URL и
      заливает фото в R2
- [ ] `supabase functions logs sign` показывает запросы с 200-м
      статусом и без trace-ошибок
- [ ] Попытка вызвать функцию без Bearer JWT возвращает 401
- [ ] Попытка подписать `reportId`, к которому нет доступа, возвращает 403

## PWA — поведение оффлайн

App shell, JS/CSS, иконки и PDF.js-воркер кэшируются Workbox'ом. Дополнительно настроен `runtimeCaching`:

- **Supabase REST/Auth** — `NetworkFirst` (4с timeout, TTL 24ч). При оффлайне отдаётся кэш последнего успешного ответа, при сети — всегда свежие данные.
- **Изображения R2** — `CacheFirst` (TTL 30 дней). Превью и фото уже просмотренных отчётов остаются доступны без сети.

Бизнес-данные (отчёты, фото, метки, черновики) живут в IndexedDB и не зависят от SW-кэша. Любая операция сначала пишется локально, потом фоновая очередь её отправляет.

## Деплой

- **Frontend**: `npm run build` → `dist/` можно раздавать с любого статик-хостинга (Cloudflare Pages, Netlify, Vercel, S3+CF). Важна корректная настройка SPA-fallback на `index.html`.
- **Edge Function `sign`**: `supabase functions deploy sign`. Перед деплоем задать секреты `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `ALLOWED_ORIGINS` через `supabase secrets set`. `SUPABASE_URL` / `SUPABASE_ANON_KEY` задавать не нужно — платформа инжектит их автоматически. См. секцию «Cloudflare R2 signer».
- **Supabase**: применить `supabase/schema.sql` + bootstrap первого админа (см. выше).
