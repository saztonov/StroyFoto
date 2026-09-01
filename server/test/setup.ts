/**
 * Выполняется до импорта модулей из server/src, поэтому config.ts подхватит
 * именно тестовую базу: dotenv не перетирает уже заданные process.env.
 */
// Дефолт совпадает с docker-compose.test.yml, поэтому после `up -d` тесты
// запускаются без дополнительной настройки.
const testUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://stroyfoto:test@localhost:55432/stroyfoto_test'

if (!testUrl) {
  throw new Error(
    'Не задан TEST_DATABASE_URL.\n' +
      '  docker compose -f docker-compose.test.yml up -d\n' +
      '  npm run test:db:setup',
  )
}

// Тот же предохранитель, что и в bootstrap-test-db.sh: тесты делают TRUNCATE,
// и цена ошибки в адресе базы — рабочие данные.
const dbName = testUrl.split('/').pop()?.split('?')[0] ?? ''
if (!dbName.endsWith('_test')) {
  throw new Error(`Имя БД '${dbName}' не оканчивается на _test — отказываюсь запускать тесты`)
}

process.env.DATABASE_URL = testUrl
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL ??= 'fatal'
process.env.JWT_ACCESS_SECRET ??= 'test-secret-not-for-production-use-only'
process.env.CORS_ORIGINS ??= 'http://localhost:5173'
