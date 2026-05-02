import { randomBytes, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { config } from '../config.js';

export interface IssueContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface IssuedRefreshToken {
  rawToken: string;
  id: string;
  expiresAt: Date;
}

export interface RefreshLookup {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function parseTtlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) {
    throw new Error(`Invalid TTL format: ${ttl}`);
  }
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * multipliers[unit];
}

function computeExpiresAt(): Date {
  const seconds = parseTtlToSeconds(config.REFRESH_TOKEN_TTL);
  return new Date(Date.now() + seconds * 1000);
}

async function insertRefreshToken(
  client: PoolClient,
  userId: string,
  ctx: IssueContext,
): Promise<IssuedRefreshToken> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = computeExpiresAt();

  const result = await client.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, tokenHash, expiresAt, ctx.userAgent ?? null, ctx.ip ?? null],
  );

  return { rawToken, id: result.rows[0].id, expiresAt };
}

export async function issueRefreshToken(
  userId: string,
  ctx: IssueContext = {},
): Promise<IssuedRefreshToken> {
  const client = await pool.connect();
  try {
    return await insertRefreshToken(client, userId, ctx);
  } finally {
    client.release();
  }
}

export async function lookupRefreshToken(
  rawToken: string,
): Promise<RefreshLookup | null> {
  const tokenHash = hashToken(rawToken);
  const result = await pool.query<{
    id: string;
    user_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    replaced_by: string | null;
  }>(
    `SELECT id, user_id, expires_at, revoked_at, replaced_by
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    replacedBy: row.replaced_by,
  };
}

export interface RotationResult {
  newToken: IssuedRefreshToken;
  userId: string;
}

export async function rotateRefreshToken(
  oldId: string,
  userId: string,
  ctx: IssueContext = {},
): Promise<RotationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const newToken = await insertRefreshToken(client, userId, ctx);
    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = now(),
           replaced_by = $1,
           last_used_at = now()
       WHERE id = $2 AND revoked_at IS NULL`,
      [newToken.id, oldId],
    );
    await client.query('COMMIT');
    return { newToken, userId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(
  rawToken: string,
  userId: string,
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenHash, userId],
  );
}

export async function markExpired(id: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
}

/**
 * Reuse-detection: помечаем revoked_at для всей цепочки ротаций — назад
 * по replaced_by (родители) и вперёд (потомки), начиная с указанного id.
 * Один UPDATE через рекурсивный CTE.
 */
export async function revokeFamily(seedId: string): Promise<void> {
  await pool.query(
    `WITH RECURSIVE
       ancestors AS (
         SELECT id, replaced_by FROM refresh_tokens WHERE id = $1
         UNION ALL
         SELECT rt.id, rt.replaced_by
         FROM refresh_tokens rt
         JOIN ancestors a ON rt.replaced_by = a.id
       ),
       descendants AS (
         SELECT id, replaced_by FROM refresh_tokens WHERE id = $1
         UNION ALL
         SELECT rt.id, rt.replaced_by
         FROM refresh_tokens rt
         JOIN descendants d ON rt.id = d.replaced_by
       ),
       family AS (
         SELECT id FROM ancestors
         UNION
         SELECT id FROM descendants
       )
     UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id IN (SELECT id FROM family)`,
    [seedId],
  );
}
