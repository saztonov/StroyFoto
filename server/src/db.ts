import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

export async function queryDbHealth(): Promise<{
  ok: true;
  latencyMs: number;
}> {
  const start = Date.now();
  await pool.query('SELECT 1');
  return { ok: true, latencyMs: Date.now() - start };
}

export async function closePool(): Promise<void> {
  await pool.end();
}
