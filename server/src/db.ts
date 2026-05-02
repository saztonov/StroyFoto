import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

// Yandex MDB требует TLS с проверкой CA. Node.js pg не читает libpq-конфиги,
// поэтому подхватываем CA вручную из тех же путей, что libpq:
// PGSSLROOTCERT env → %APPDATA%/postgresql/root.crt (Win) → ~/.postgresql/root.crt (Unix).
function resolveSslCa(): string[] | undefined {
  const candidates = [
    process.env.PGSSLROOTCERT,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'postgresql', 'root.crt')
      : undefined,
    path.join(os.homedir(), '.postgresql', 'root.crt'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const certs = raw
          .split(/(?=-----BEGIN CERTIFICATE-----)/g)
          .map((chunk) => chunk.trim())
          .filter((chunk) => chunk.startsWith('-----BEGIN CERTIFICATE-----'));
        if (certs.length > 0) return certs;
      } catch {
        // ignore unreadable file, try next candidate
      }
    }
  }
  return undefined;
}

const sslCa = resolveSslCa();
const sslmodeMatch = config.DATABASE_URL.match(/[?&]sslmode=([^&]+)/i);
const sslmode = sslmodeMatch?.[1]?.toLowerCase();
const requiresSsl =
  sslmode === 'require' || sslmode === 'verify-ca' || sslmode === 'verify-full';
// Стрипаем sslmode из URL: pg драйвер при sslmode=verify-* игнорирует
// объект `ssl` и использует встроенный Node truststore без нашего CA.
const cleanedConnectionString = config.DATABASE_URL.replace(
  /([?&])sslmode=[^&]*&?/i,
  (_match, sep) => (sep === '?' ? '?' : '&'),
)
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?');

export const pool = new Pool({
  connectionString: cleanedConnectionString,
  max: 20,
  ssl: requiresSsl
    ? sslCa
      ? { ca: sslCa, rejectUnauthorized: true }
      : { rejectUnauthorized: false }
    : undefined,
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
