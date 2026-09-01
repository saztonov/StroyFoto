import { readdir } from 'node:fs/promises'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, truncateAll } from './helpers/db.js'

describe('тестовый контур', () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await pool.end()
  })

  it('поднята схема, совпадающая с продовой', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const tables = rows.map((r) => r.tablename)
    // Точное число не фиксируем — каждая новая таблица ломала бы тест. Важно,
    // что baseline развернулся И поверх него легли миграции.
    expect(tables).toContain('app_users') // из baseline-снапшота
    expect(tables).toContain('report_performers') // из 202607311600
    expect(tables).toContain('report_photo_plan_marks') // из 202608031200
    expect(tables).toContain('password_reset_requests') // из 202609011210
    expect(tables).toContain('schema_migrations')

    // Колонки, добавленные миграцией session_version.
    const { rows: columns } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'app_users'`,
    )
    expect(columns.map((c) => c.column_name)).toContain('session_version')
  })

  it('все файлы из db/migrations записаны в журнал', async () => {
    const onDisk = (await readdir('db/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM public.schema_migrations ORDER BY filename',
    )
    // Список не хардкодим: каждая новая миграция иначе ломала бы этот тест.
    expect(rows.map((r) => r.filename)).toEqual(onDisk)
  })

  it('truncateAll чистит данные, но не журнал миграций', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS n FROM public.schema_migrations',
    )
    await pool.query(
      `INSERT INTO app_users (email, password_hash) VALUES ('smoke@example.com', 'x')`,
    )
    await truncateAll()

    const users = await pool.query('SELECT count(*)::int AS n FROM app_users')
    const after = await pool.query(
      'SELECT count(*)::int AS n FROM public.schema_migrations',
    )
    expect(users.rows[0].n).toBe(0)
    expect(after.rows[0].n).toBe(before.rows[0].n)
    expect(after.rows[0].n).toBeGreaterThan(0)
  })
})
