import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * server/src написан под NodeNext: относительные импорты указывают на «.js»,
 * которых на диске нет (рядом лежат .ts). Штатный резолвер Vite такой импорт
 * не находит, поэтому подменяем расширение, когда .ts действительно существует.
 */
export function nodeNextJsToTs() {
  return {
    name: 'nodenext-js-to-ts',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null
      const candidate = path.resolve(path.dirname(importer), `${source.slice(0, -3)}.ts`)
      return fs.existsSync(candidate) ? candidate : null
    },
  }
}

/** Интеграционные тесты бэкенда: живой PostgreSQL, TRUNCATE между кейсами. */
export default defineConfig({
  plugins: [nodeNextJsToTs()],
  test: {
    name: 'server',
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
    setupFiles: ['server/test/setup.ts'],
    // Тесты гоняют TRUNCATE и намеренно устраивают гонки в БД: параллельный
    // прогон сделал бы их флаки.
    fileParallelism: false,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
