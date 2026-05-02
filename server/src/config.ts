import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Загружаем server/.env независимо от текущей CWD.
// server/src/config.ts → ../.env даёт server/.env;
// в скомпилированном виде server/dist/config.js → ../.env тоже даёт server/.env.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(moduleDir, '../.env') });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  CLOUDRU_TENANT_ID: z.string().optional(),
  CLOUDRU_KEY_ID: z.string().optional(),
  CLOUDRU_KEY_SECRET: z.string().optional(),
  CLOUDRU_BUCKET: z.string().optional(),
  CLOUDRU_ENDPOINT: z.string().default('https://s3.cloud.ru'),
  CLOUDRU_REGION: z.string().default('ru-central-1'),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    '[config] Invalid environment variables:',
    JSON.stringify(parsed.error.format(), null, 2),
  );
  process.exit(1);
}

const raw = parsed.data;

export const config = {
  ...raw,
  CORS_ORIGINS: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;

export type Config = typeof config;
