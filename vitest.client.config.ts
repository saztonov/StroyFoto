import path from 'node:path'
import { defineConfig } from 'vitest/config'

/** Юниты фронтенда. Без БД и без сети — только чистая логика. */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    name: 'client',
    // jsdom нужен ради sessionStorage: без него authStorage не проверить.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
