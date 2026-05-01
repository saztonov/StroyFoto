#!/usr/bin/env node
// CLI-утилита миграции объектов из Cloudflare R2 в Cloud.ru S3.
//
// Команды:
//   check                    Preflight: env, связь с Supabase/R2/Cloud.ru, статистика
//   run [opts]               Перенос всех объектов R2 → Cloud.ru
//   verify [opts]            Проверка после миграции
//   help                     Это сообщение
//
// Глобальные опции:
//   --config=PATH            Путь к .env.migrate (по умолчанию ./.env.migrate).
//                            ВАЖНО: используем --config, а не --env-file, потому
//                            что Node 22 интерпретирует --env-file как свой
//                            built-in dotenv-loader и забирает аргумент себе.
//   --errors-log=PATH        Путь к JSONL-журналу (по умолчанию ./migration-errors.jsonl)
//
// Опции `run`:
//   --concurrency=N          Параллельных копий (default 4, max 32)
//   --retries=N              Повторов на ошибку 5xx/timeout (default 3)
//   --limit=N                Перенести максимум N строк (для тестов)
//   --dry-run                Не писать в Cloud.ru и не обновлять БД
//   --only=photos|plans|all  Перенести только фото/планы (default all)
//
// Опции `verify`:
//   --concurrency=N          Параллельных HEAD-запросов (default 8)
//   --sample=N               Проверить N случайных строк, а не все
//   --compare-r2             Дополнительно HEAD'ать R2 и сравнить размеры
//
// Exit codes:
//   0  — успех
//   1  — ошибка валидации/CLI или проверки не пройдены
//   2  — миграция завершилась, но с ошибками по отдельным объектам

import { setErrorsLogPath, log } from './log.mjs'
import { checkCommand } from './check.mjs'
import { runCommand } from './run.mjs'
import { verifyCommand } from './verify.mjs'

function parseArgs(argv) {
  const out = { _: [] }
  for (const raw of argv) {
    if (raw.startsWith('--')) {
      const eq = raw.indexOf('=')
      if (eq > 0) {
        const key = camelCase(raw.slice(2, eq))
        out[key] = raw.slice(eq + 1)
      } else {
        out[camelCase(raw.slice(2))] = true
      }
    } else {
      out._.push(raw)
    }
  }
  return out
}

function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
}

function printHelp() {
  log.raw(`
СтройФото — миграция объектов R2 → Cloud.ru S3

Использование:
  node scripts/migrate-storage/cli.mjs <command> [options]

  npm run migrate:storage -- check
  npm run migrate:storage -- run --concurrency=8 --limit=100
  npm run migrate:storage -- verify --sample=200 --compare-r2

Команды:
  check       Preflight: окружение, доступ к Supabase, R2, Cloud.ru,
              round-trip PUT/HEAD/GET/DELETE, сводная статистика. Ничего не меняет.
  run         Перенос всех строк со storage='r2' в Cloud.ru, с обновлением
              storage='cloudru' в Supabase. Идемпотентно (можно перезапускать).
  verify      Проверяет, что для каждой строки storage='cloudru' объект реально
              лежит в Cloud.ru. Опционально сравнивает размеры с R2.
  help        Это сообщение.

Глобальные опции:
  --config=PATH          Путь к .env.migrate (default: ./.env.migrate)
                         (НЕ используйте --env-file — это встроенный флаг Node 22)
  --errors-log=PATH      Путь к JSONL-журналу (default: ./migration-errors.jsonl)

Опции команды run:
  --concurrency=N        Параллельных копий (default 4, max 32)
  --retries=N            Повторов на 5xx/timeout (default 3)
  --limit=N              Перенести максимум N строк (debug-режим)
  --dry-run              Не писать в Cloud.ru и не обновлять БД
  --only=photos|plans|all
                         Что переносить (default all)

Опции команды verify:
  --concurrency=N        Параллельных HEAD-запросов (default 8)
  --sample=N             Проверить N случайных строк, а не все
  --compare-r2           Дополнительно HEAD'ать R2 и сравнить размеры

Подробности: scripts/migrate-storage/README.md
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.errorsLog) setErrorsLogPath(args.errorsLog)

  const cmd = args._[0]
  if (!cmd || cmd === 'help' || args.help) {
    printHelp()
    return 0
  }

  switch (cmd) {
    case 'check':
      return await checkCommand(args)
    case 'run':
      return await runCommand(args)
    case 'verify':
      return await verifyCommand(args)
    default:
      log.error(`Неизвестная команда: ${cmd}`)
      printHelp()
      return 1
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    log.error('CLI упал с необработанной ошибкой', err)
    process.exit(1)
  })
