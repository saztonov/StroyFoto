# СтройФото

Русскоязычное веб-приложение и PWA для фотоконтроля строительства: отчёты, планы, метки на чертежах. MVP, mobile-first, со светлой и тёмной темой.

## Стек

- **Vite + React 18 + TypeScript**
- **Ant Design 5** (локаль `ru_RU`, светлая/тёмная тема)
- **React Router v6** (`createBrowserRouter`)
- **Supabase** (Auth + Postgres, напрямую из браузера)
- **vite-plugin-pwa** (manifest + service worker, installable PWA)

Отдельного backend-API нет. Вся логика во фронтенде; файлы планируется хранить в приватном Cloudflare R2 через тонкую edge-функцию, которая будет выдавать presigned URL (добавится отдельным шагом).

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

| Переменная                 | Назначение                                  | Обязательна |
| -------------------------- | ------------------------------------------- | ----------- |
| `VITE_SUPABASE_URL`        | URL проекта Supabase                        | да          |
| `VITE_SUPABASE_ANON_KEY`   | Публичный anon-ключ Supabase                | да          |
| `VITE_PRESIGN_URL`         | Edge-функция для presigned URL к R2         | позже       |

`.env.production` уже содержит публичные ключи для staging-проекта Supabase и коммитится в репозиторий намеренно (anon-ключ публичный по дизайну).

## Структура проекта

```
src/
├── app/            # корневой App, провайдеры, router, layouts
│   ├── providers/  # ThemeProvider, AuthProvider
│   ├── router/     # routes.tsx, guards.tsx
│   └── layouts/    # AppShell, Desktop/Mobile/Auth layouts
├── pages/          # страницы (auth, reports, plans, settings, admin)
├── features/       # фича-модули (пусто — появятся в следующих шагах)
├── entities/       # доменные типы (Profile, …)
├── shared/         # ui, hooks, i18n, config
├── lib/            # интеграции (supabase)
├── offline/        # IndexedDB / sync queue (пусто — следующий шаг)
└── services/       # auth.ts и т.д.
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

- Сборка (`tsc -b && vite build`), PWA-манифест и service worker.
- Маршрутизация и все 4 guard'а.
- Вход, регистрация, выход через Supabase Auth.
- Экран ожидания активации с кнопкой «Обновить статус».
- Переключение светлой / тёмной / системной темы с сохранением.
- Мобильный и десктоп layout переключаются по ширине экрана.
- Русская локализация интерфейса AntD (`ru_RU`) и `dayjs`.

## Что пока заглушка (следующие шаги)

- Список / создание / детали отчётов — только пустые состояния.
- Раздел «Планы» — пустое состояние (PDF-плеера и выбора точки ещё нет).
- Все разделы `/admin/*` — пустые состояния (нет CRUD).
- IndexedDB / очередь синхронизации (`src/offline/` пока пустой).
- Сжатие фото и работа с камерой.
- Отображение PDF-планов (`pdfjs-dist`).
- Управление локальным хранением истории (в `/settings` пока только тема).
- SQL-миграции и RLS-политики Supabase (`profiles`, `projects`, `project_memberships`, `work_types`, `performers`, `plans`, `reports`, `report_photos`, `report_plan_marks`).

## Следующий шаг

Применить SQL-миграции и RLS в Supabase, затем реализовать CRUD справочников в `/admin/*`, используя уже готовые guard'ы и layout.
