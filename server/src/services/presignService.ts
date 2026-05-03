import { AwsClient } from 'aws4fetch';
import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError } from '../http/errors.js';
import type { AuthenticatedUser } from '../auth/middleware.js';

export type PresignOp = 'put' | 'get' | 'delete';
export type PresignKind = 'photo' | 'photo_thumb' | 'plan';

export interface PresignInput {
  op: PresignOp;
  kind: PresignKind;
  key: string;
  reportId?: string;
  projectId?: string;
  planId?: string;
  contentType?: string;
  user: AuthenticatedUser;
}

export interface SignedUrl {
  url: string;
  method: 'PUT' | 'GET' | 'DELETE';
  headers: Record<string, string>;
  expiresAt: number;
}

const ALLOWED_CT = new Set(['image/jpeg', 'application/pdf']);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PHOTO_RE = new RegExp(`^photos/(${UUID})/(${UUID})\\.jpg$`);
const PHOTO_THUMB_RE = new RegExp(`^photos/(${UUID})/(${UUID})-thumb\\.jpg$`);
const PLAN_RE = new RegExp(`^plans/(${UUID})/(${UUID})\\.pdf$`);

interface ParsedKey {
  kind: PresignKind;
  parent: string;
  entity: string;
}

function parseKey(kind: PresignKind, key: string): ParsedKey | null {
  let m: RegExpMatchArray | null = null;
  if (kind === 'photo') m = key.match(PHOTO_RE);
  else if (kind === 'photo_thumb') m = key.match(PHOTO_THUMB_RE);
  else if (kind === 'plan') m = key.match(PLAN_RE);
  if (!m) return null;
  return { kind, parent: m[1], entity: m[2] };
}

// PUT/GET — 10 минут. На GPRS/3G upload крупного фото может занимать
// 100+ секунд; добавим запас под очередь sync-loop и retry внутри клиента.
// Подпись делается per-PUT (lazy presign в src/services/photos.ts), так что
// «срок жизни» URL — это окно от выдачи до начала PUT, а не общее время сессии.
const TTL_PUT_GET = 60 * 10;
const TTL_DELETE = 60 * 2;

function methodFor(op: PresignOp): 'PUT' | 'GET' | 'DELETE' {
  if (op === 'put') return 'PUT';
  if (op === 'get') return 'GET';
  return 'DELETE';
}

async function presignCloudRu(
  op: PresignOp,
  key: string,
  contentType?: string,
): Promise<SignedUrl> {
  const tenantId = config.CLOUDRU_TENANT_ID;
  const keyId = config.CLOUDRU_KEY_ID;
  const keySecret = config.CLOUDRU_KEY_SECRET;
  const bucket = config.CLOUDRU_BUCKET;
  if (!tenantId || !keyId || !keySecret || !bucket) {
    throw new AppError(
      500,
      'CLOUDRU_NOT_CONFIGURED',
      'Cloud.ru S3 не настроен на сервере.',
    );
  }
  const endpoint = config.CLOUDRU_ENDPOINT.replace(/\/$/, '');
  const region = config.CLOUDRU_REGION;

  const client = new AwsClient({
    accessKeyId: `${tenantId}:${keyId}`,
    secretAccessKey: keySecret,
    service: 's3',
    region,
  });

  const method = methodFor(op);
  const expires = op === 'delete' ? TTL_DELETE : TTL_PUT_GET;
  const url = `${endpoint}/${bucket}/${encodeURI(key)}?X-Amz-Expires=${expires}`;

  const init: RequestInit & { headers?: Record<string, string> } = { method };
  if (op === 'put' && contentType) {
    init.headers = { 'Content-Type': contentType };
  }
  const signed = await client.sign(new Request(url, init), {
    aws: { signQuery: true },
  });

  const headers: Record<string, string> = {};
  if (op === 'put' && contentType) headers['Content-Type'] = contentType;

  return {
    url: signed.url,
    method,
    headers,
    expiresAt: Math.floor(Date.now() / 1000) + expires,
  };
}

async function checkPhotoAccess(input: {
  user: AuthenticatedUser;
  reportId: string;
  op: PresignOp;
}): Promise<void> {
  const result = await pool.query<{
    project_id: string;
    author_id: string;
  }>(
    `SELECT project_id, author_id FROM reports WHERE id = $1`,
    [input.reportId],
  );
  if (result.rowCount === 0) {
    throw new AppError(403, 'FORBIDDEN', 'Нет доступа к отчёту.');
  }
  const row = result.rows[0];
  if (input.op === 'put' || input.op === 'delete') {
    if (input.user.role !== 'admin' && row.author_id !== input.user.id) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Загружать или удалять фото может только автор отчёта.',
      );
    }
    return;
  }
  // GET: автор / член проекта / admin
  if (input.user.role === 'admin' || row.author_id === input.user.id) return;
  const member = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM project_memberships
        WHERE user_id = $1 AND project_id = $2
     ) AS ok`,
    [input.user.id, row.project_id],
  );
  if (member.rows[0]?.ok !== true) {
    throw new AppError(403, 'FORBIDDEN', 'Нет доступа к отчёту.');
  }
}

async function checkPlanAccess(input: {
  user: AuthenticatedUser;
  projectId: string;
  planId: string;
  op: PresignOp;
}): Promise<void> {
  const project = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1`,
    [input.projectId],
  );
  if (project.rowCount === 0) {
    throw new AppError(403, 'FORBIDDEN', 'Проект недоступен.');
  }

  if (input.op === 'put') {
    if (input.user.role === 'admin') return;
    const member = await pool.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM project_memberships
          WHERE user_id = $1 AND project_id = $2
       ) AS ok`,
      [input.user.id, input.projectId],
    );
    if (member.rows[0]?.ok !== true) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Нет доступа к проекту для загрузки плана.',
      );
    }
    return;
  }

  if (input.op === 'delete') {
    const plan = await pool.query<{
      project_id: string;
      uploaded_by: string | null;
    }>(
      `SELECT project_id, uploaded_by FROM plans WHERE id = $1`,
      [input.planId],
    );
    if (plan.rowCount === 0) {
      throw new AppError(403, 'FORBIDDEN', 'Нет доступа к плану.');
    }
    if (plan.rows[0].project_id !== input.projectId) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'projectId не совпадает с фактическим планом.',
      );
    }
    if (input.user.role === 'admin') return;
    if (plan.rows[0].uploaded_by !== input.user.id) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Удалять план может только администратор или загрузивший.',
      );
    }
    return;
  }

  // GET: plan должен существовать, project_id совпадать;
  // далее — admin или member проекта.
  const plan = await pool.query<{ id: string; project_id: string }>(
    `SELECT id, project_id FROM plans WHERE id = $1`,
    [input.planId],
  );
  if (plan.rowCount === 0) {
    throw new AppError(403, 'FORBIDDEN', 'Нет доступа к плану.');
  }
  if (plan.rows[0].project_id !== input.projectId) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'projectId не совпадает с фактическим планом.',
    );
  }
  if (input.user.role === 'admin') return;
  const member = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM project_memberships
        WHERE user_id = $1 AND project_id = $2
     ) AS ok`,
    [input.user.id, input.projectId],
  );
  if (member.rows[0]?.ok !== true) {
    throw new AppError(403, 'FORBIDDEN', 'Нет доступа к плану.');
  }
}

export async function presign(input: PresignInput): Promise<SignedUrl> {
  if (input.op === 'put') {
    if (!input.contentType || !ALLOWED_CT.has(input.contentType)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'contentType должен быть image/jpeg или application/pdf.',
      );
    }
  }

  if (input.key.length > 256) {
    throw new AppError(400, 'VALIDATION_ERROR', 'object key слишком длинный.');
  }

  const parsed = parseKey(input.kind, input.key);
  if (!parsed) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Некорректный object key.');
  }

  if (input.kind === 'photo' || input.kind === 'photo_thumb') {
    if (!input.reportId || input.reportId !== parsed.parent) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'reportId не совпадает с object key.',
      );
    }
    await checkPhotoAccess({
      user: input.user,
      reportId: input.reportId,
      op: input.op,
    });
  } else {
    if (!input.projectId || input.projectId !== parsed.parent) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'projectId не совпадает с object key.',
      );
    }
    if (!input.planId || input.planId !== parsed.entity) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'planId не совпадает с object key.',
      );
    }
    await checkPlanAccess({
      user: input.user,
      projectId: input.projectId,
      planId: input.planId,
      op: input.op,
    });
  }

  return presignCloudRu(input.op, input.key, input.contentType);
}
