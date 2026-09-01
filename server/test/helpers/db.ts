import { pool } from '../../src/db.js'

/**
 * Чистит все таблицы, кроме журнала миграций: схему между тестами
 * пересобирать незачем, а schema_migrations должен пережить прогон.
 */
export async function truncateAll(): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  )
  if (rows.length === 0) {
    throw new Error('В тестовой БД нет таблиц — выполните npm run test:db:setup')
  }
  const list = rows.map((r) => `public.${r.tablename}`).join(', ')
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

export { pool }
