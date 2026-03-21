# СтройФото — Инструкции для Claude Code

## Язык

- Все планы в режиме планирования создавать на **русском языке**
- Комментарии в коде и commit-сообщения — на английском

## Структура монорепо

```
apps/api        — Fastify 5 + Supabase (PostgreSQL + Storage) (порт 3001)
apps/web        — React 19 + Vite 6 + Dexie 4 + Tailwind CSS 4 (порт 5173)
packages/shared — Zod-схемы, типы, константы (общие для api и web)
e2e/            — Playwright E2E тесты
supabase/migrations/ — Структура БД (prod.sql)
```

## Команды

```bash
pnpm dev              # Все сервисы
pnpm build            # Сборка
pnpm typecheck        # Проверка типов
pnpm test             # Unit-тесты (Vitest)
pnpm e2e              # E2E тесты (Playwright)
pnpm db:seed          # Демо-данные (через Supabase)
```

## Технологические соглашения

- TypeScript strict во всех пакетах
- Zod для валидации на границах (API входы, формы) — схемы в `packages/shared`
- Dexie 4 для IndexedDB (офлайн-хранилище на клиенте)
- Supabase (`@supabase/supabase-js`) для PostgreSQL и Storage (бэкенд, service_role key)
- Tailwind CSS 4 для стилей (utility-first, без отдельных CSS-файлов)
- snake_case в БД, camelCase в API — маппинг через `utils/case-transform.ts`

## Критические паттерны — не ломать

1. **Offline-first**: все данные сохраняются в IndexedDB мгновенно, синхронизируются при наличии сети
2. **Порядок синхронизации**: UPSERT_REPORT → UPLOAD_PHOTO → FINALIZE_REPORT (FK-зависимость)
3. **Client-side UUID**: `crypto.randomUUID()` — записи создаются без обращения к серверу
4. **Идемпотентность**: clientId + X-Idempotency-Key — дубликаты безопасны
5. **Token auto-refresh**: при 401 → refresh → повтор операции
6. **Экспоненциальный backoff**: 5с × 2^N, max 5 мин при 5xx

## Ограничения

- Макс. 20 фото на отчёт (`MAX_PHOTOS_PER_REPORT` в shared/constants)
- Макс. 15 МБ на файл (`MAX_FILE_SIZE_BYTES`)
- Автосжатие: JPEG, max 1920px, quality 0.8
- TTL справочников: 24 часа (`REFERENCE_DATA_TTL_MS`)

## Демо-пользователи

- admin / admin123 (ADMIN)
- worker / worker123 (WORKER)
