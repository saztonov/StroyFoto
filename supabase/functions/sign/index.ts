// Supabase Edge Function: выдаёт короткоживущие presigned URL к приватному
// объектному хранилищу. Поддерживается два провайдера:
//   - 'cloudru' (по умолчанию) — Cloud.ru Object Storage (https://s3.cloud.ru),
//     регион ru-central-1. Полностью S3-совместим, подпись AWS SigV4.
//   - 'r2'     — Cloudflare R2. Используется только для миграции исторических
//     данных (страница /admin/storage-migration). После переноса всех
//     объектов R2-секреты можно удалить и вообще убрать ветку 'r2'.
//
// Все секреты хранилищ хранятся в Supabase (`supabase secrets set ...`) и
// никогда не покидают функцию. SUPABASE_URL / SUPABASE_ANON_KEY инжектит сама
// платформа — задавать их вручную не нужно (префикс SUPABASE_ зарезервирован).
//
// Auth делаем ВНУТРИ функции через supabaseClient.auth.getUser(): это реальный
// запрос к Auth API, а не локальная HMAC-проверка. Gateway-ный verify_jwt
// НАРОЧНО выключен (см. supabase/config.toml [functions.sign]) — он ломается,
// если проект перешёл на новые JWT signing keys или ротировал legacy-секрет.
// Наш authenticate() проверяет и подпись, и существование пользователя, и даёт
// user.id для RLS — это строже, чем gateway.
//
// Никакого service_role: права проверяются через клиентский JWT + RLS.
//
// Deno runtime, Web Crypto — aws4fetch работает «из коробки».

// @ts-nocheck — этот файл компилируется и запускается в Deno; локальный
// tsconfig фронтенда его не проверяет.

import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'

type Op = 'put' | 'get' | 'delete'
type Kind = 'photo' | 'photo_thumb' | 'plan'
type Provider = 'cloudru' | 'r2'

interface SignBody {
  op: Op
  kind: Kind
  key: string
  reportId?: string
  projectId?: string
  planId?: string
  contentType?: string
  provider?: Provider
}

interface SignedUrl {
  url: string
  method: 'PUT' | 'GET' | 'DELETE'
  headers: Record<string, string>
  expiresAt: number
  provider: Provider
}

const ALLOWED_CT = new Set(['image/jpeg', 'application/pdf'])

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PHOTO_RE = new RegExp(`^photos/(${UUID})/(${UUID})\\.jpg$`)
const PHOTO_THUMB_RE = new RegExp(`^photos/(${UUID})/(${UUID})-thumb\\.jpg$`)
const PLAN_RE = new RegExp(`^plans/(${UUID})/(${UUID})\\.pdf$`)

interface ParsedKey {
  kind: Kind
  parent: string
  entity: string
}

function parseKey(kind: Kind, key: string): ParsedKey | null {
  let m: RegExpMatchArray | null = null
  if (kind === 'photo') m = key.match(PHOTO_RE)
  else if (kind === 'photo_thumb') m = key.match(PHOTO_THUMB_RE)
  else if (kind === 'plan') m = key.match(PLAN_RE)
  if (!m) return null
  return { kind, parent: m[1], entity: m[2] }
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TTL_PUT_GET = 60 * 5
const TTL_DELETE = 60

function envOptional(name: string): string | null {
  const v = Deno.env.get(name)
  return v && v.length > 0 ? v : null
}

function requireEnv(name: string): string {
  const v = envOptional(name)
  if (!v) throw new HttpError(500, `env ${name} not set`)
  return v
}

/**
 * Подписывает запрос к Cloud.ru S3 (https://s3.cloud.ru, ru-central-1).
 *
 * Cloud.ru S3 полностью S3-совместим: SigV4, регион ru-central-1, сервис s3.
 * Особенность — accessKeyId формата `<tenant_id>:<key_id>` (для подписи
 * это просто опаковая строка, aws4fetch обрабатывает её корректно).
 */
async function presignCloudRu(op: Op, key: string, contentType?: string): Promise<SignedUrl> {
  const tenantId = requireEnv('CLOUDRU_TENANT_ID')
  const keyId = requireEnv('CLOUDRU_KEY_ID')
  const keySecret = requireEnv('CLOUDRU_KEY_SECRET')
  const bucket = requireEnv('CLOUDRU_BUCKET')
  const endpoint = envOptional('CLOUDRU_ENDPOINT') ?? 'https://s3.cloud.ru'
  const region = envOptional('CLOUDRU_REGION') ?? 'ru-central-1'

  const client = new AwsClient({
    accessKeyId: `${tenantId}:${keyId}`,
    secretAccessKey: keySecret,
    service: 's3',
    region,
  })

  const method: 'PUT' | 'GET' | 'DELETE' =
    op === 'put' ? 'PUT' : op === 'get' ? 'GET' : 'DELETE'
  const expires = op === 'delete' ? TTL_DELETE : TTL_PUT_GET

  const url = `${endpoint.replace(/\/$/, '')}/${bucket}/${encodeURI(
    key,
  )}?X-Amz-Expires=${expires}`

  const signedReq = await client.sign(
    new Request(url, {
      method,
      headers:
        op === 'put' && contentType ? { 'Content-Type': contentType } : undefined,
    }),
    { aws: { signQuery: true } },
  )

  const headers: Record<string, string> = {}
  if (op === 'put' && contentType) headers['Content-Type'] = contentType

  return {
    url: signedReq.url,
    method,
    headers,
    expiresAt: Math.floor(Date.now() / 1000) + expires,
    provider: 'cloudru',
  }
}

/**
 * Подписывает запрос к Cloudflare R2. Используется только во время миграции —
 * после переноса всех объектов на Cloud.ru эту ветку и переменные окружения
 * R2_* можно удалить.
 */
async function presignR2(op: Op, key: string, contentType?: string): Promise<SignedUrl> {
  const accountId = requireEnv('R2_ACCOUNT_ID')
  const bucket = requireEnv('R2_BUCKET')
  const client = new AwsClient({
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  })

  const method: 'PUT' | 'GET' | 'DELETE' =
    op === 'put' ? 'PUT' : op === 'get' ? 'GET' : 'DELETE'
  const expires = op === 'delete' ? TTL_DELETE : TTL_PUT_GET

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURI(
    key,
  )}?X-Amz-Expires=${expires}`

  const signedReq = await client.sign(
    new Request(endpoint, {
      method,
      headers:
        op === 'put' && contentType ? { 'Content-Type': contentType } : undefined,
    }),
    { aws: { signQuery: true } },
  )

  const headers: Record<string, string> = {}
  if (op === 'put' && contentType) headers['Content-Type'] = contentType

  return {
    url: signedReq.url,
    method,
    headers,
    expiresAt: Math.floor(Date.now() / 1000) + expires,
    provider: 'r2',
  }
}

async function presign(provider: Provider, op: Op, key: string, contentType?: string): Promise<SignedUrl> {
  if (provider === 'cloudru') return presignCloudRu(op, key, contentType)
  if (provider === 'r2') return presignR2(op, key, contentType)
  throw new HttpError(400, `unsupported provider: ${provider}`)
}

function validateBody(b: SignBody): void {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'bad body')
  if (!['put', 'get', 'delete'].includes(b.op)) throw new HttpError(400, 'bad op')
  if (!['photo', 'photo_thumb', 'plan'].includes(b.kind)) throw new HttpError(400, 'bad kind')
  if (typeof b.key !== 'string' || b.key.length > 256) throw new HttpError(400, 'bad key')
  if (b.provider !== undefined && b.provider !== 'cloudru' && b.provider !== 'r2') {
    throw new HttpError(400, 'bad provider')
  }
  if (b.op === 'put') {
    if (!b.contentType || !ALLOWED_CT.has(b.contentType)) {
      throw new HttpError(400, 'contentType должен быть image/jpeg или application/pdf')
    }
  }
}

function buildCors(origin: string | null): Record<string, string> {
  const allowedRaw = Deno.env.get('ALLOWED_ORIGINS') ?? ''
  const allowed = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean)
  // Если список пуст — разрешаем любой origin (удобно в dev). В проде
  // задайте ALLOWED_ORIGINS через `supabase secrets set`.
  const allow =
    allowed.length === 0
      ? (origin ?? '*')
      : origin && allowed.includes(origin)
        ? origin
        : allowed[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

interface VerifiedUser {
  sub: string
  client: SupabaseClient
}

async function authenticate(req: Request): Promise<VerifiedUser> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'missing bearer token')
  }

  const supabaseUrl = requireEnv('SUPABASE_URL')
  const supabaseAnonKey = requireEnv('SUPABASE_ANON_KEY')
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    throw new HttpError(401, `jwt verify failed: ${error?.message ?? 'no user'}`)
  }
  return { sub: data.user.id, client }
}

interface CheckArgs {
  user: VerifiedUser
  parsed: ParsedKey
  op: Op
  bodyReportId?: string
  bodyProjectId?: string
  bodyPlanId?: string
  provider: Provider
}

async function checkAccess(args: CheckArgs): Promise<void> {
  const { parsed, bodyReportId, bodyProjectId, bodyPlanId, provider } = args

  // Доступ к R2 разрешён только админу — это легаси-провайдер,
  // используется исключительно во время миграции исторических объектов.
  if (provider === 'r2') {
    await requireAdmin(args.user)
    if (args.op === 'put') {
      throw new HttpError(403, 'PUT в R2 запрещён: новые объекты грузятся в Cloud.ru')
    }
  }

  if (parsed.kind === 'photo' || parsed.kind === 'photo_thumb') {
    if (!bodyReportId || bodyReportId !== parsed.parent) {
      throw new HttpError(400, 'reportId не совпадает с object key')
    }
    await checkPhotoAccess(args, bodyReportId)
    return
  }

  if (parsed.kind === 'plan') {
    if (!bodyProjectId || bodyProjectId !== parsed.parent) {
      throw new HttpError(400, 'projectId не совпадает с object key')
    }
    if (!bodyPlanId || bodyPlanId !== parsed.entity) {
      throw new HttpError(400, 'planId не совпадает с object key')
    }
    await checkPlanAccess(args, bodyProjectId, bodyPlanId)
    return
  }

  throw new HttpError(400, 'unknown kind')
}

async function requireAdmin(user: VerifiedUser): Promise<void> {
  const { data: prof, error: profErr } = await user.client
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.sub)
    .maybeSingle()
  if (profErr) throw new HttpError(502, `supabase profiles: ${profErr.message}`)
  if (!prof || !prof.is_active || prof.role !== 'admin') {
    throw new HttpError(403, 'операция доступна только администратору')
  }
}

async function checkPhotoAccess(args: CheckArgs, reportId: string): Promise<void> {
  const { user, op } = args
  const { data, error } = await user.client
    .from('reports')
    .select('id, project_id, author_id')
    .eq('id', reportId)
    .maybeSingle()

  if (error) throw new HttpError(502, `supabase reports: ${error.message}`)
  if (!data) throw new HttpError(403, 'нет доступа к отчёту')

  if (op === 'put' || op === 'delete') {
    if (data.author_id !== user.sub) {
      throw new HttpError(403, 'только автор может загружать или удалять фото отчёта')
    }
  }
}

async function checkPlanAccess(
  args: CheckArgs,
  projectId: string,
  planId: string,
): Promise<void> {
  const { user, op } = args

  if (op === 'put') {
    const { data: prof, error: profErr } = await user.client
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.sub)
      .maybeSingle()
    if (profErr) throw new HttpError(502, `supabase profiles: ${profErr.message}`)
    if (!prof || !prof.is_active) {
      throw new HttpError(403, 'только активный пользователь может загружать планы')
    }

    if (prof.role === 'admin') {
      const { data: proj, error: projErr } = await user.client
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .maybeSingle()
      if (projErr) throw new HttpError(502, `supabase projects: ${projErr.message}`)
      if (!proj) throw new HttpError(403, 'проект недоступен')
      return
    }

    const { data: membership, error: memErr } = await user.client
      .from('project_memberships')
      .select('project_id')
      .eq('project_id', projectId)
      .eq('user_id', user.sub)
      .maybeSingle()
    if (memErr) throw new HttpError(502, `supabase memberships: ${memErr.message}`)
    if (!membership) throw new HttpError(403, 'нет доступа к проекту для загрузки плана')
    return
  }

  if (op === 'delete') {
    const { data: prof, error: profErr } = await user.client
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.sub)
      .maybeSingle()
    if (profErr) throw new HttpError(502, `supabase profiles: ${profErr.message}`)
    if (!prof || !prof.is_active) {
      throw new HttpError(403, 'только активный пользователь может удалять планы')
    }

    if (prof.role === 'admin') {
      const { data: proj, error: projErr } = await user.client
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .maybeSingle()
      if (projErr) throw new HttpError(502, `supabase projects: ${projErr.message}`)
      if (!proj) throw new HttpError(403, 'проект недоступен')
      return
    }

    // Не-админ: только загрузивший план может удалить
    const { data: plan, error: planErr } = await user.client
      .from('plans')
      .select('uploaded_by')
      .eq('id', planId)
      .maybeSingle()
    if (planErr) throw new HttpError(502, `supabase plans: ${planErr.message}`)
    if (!plan || plan.uploaded_by !== user.sub) {
      throw new HttpError(403, 'только администратор или загрузивший план может его удалить')
    }
    return
  }

  const { data: plan, error: planErr } = await user.client
    .from('plans')
    .select('id, project_id')
    .eq('id', planId)
    .maybeSingle()
  if (planErr) throw new HttpError(502, `supabase plans: ${planErr.message}`)
  if (!plan) throw new HttpError(403, 'нет доступа к плану')
  if (plan.project_id !== projectId) {
    throw new HttpError(400, 'projectId в теле не совпадает с фактическим планом')
  }
}

Deno.serve(async (req) => {
  const cors = buildCors(req.headers.get('Origin'))

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405, cors)
  }

  try {
    const body = (await req.json()) as SignBody
    validateBody(body)

    const provider: Provider = body.provider ?? 'cloudru'
    const user = await authenticate(req)

    const parsed = parseKey(body.kind, body.key)
    if (!parsed) throw new HttpError(400, 'некорректный object key')

    await checkAccess({
      user,
      parsed,
      op: body.op,
      bodyReportId: body.reportId,
      bodyProjectId: body.projectId,
      bodyPlanId: body.planId,
      provider,
    })

    const signed = await presign(provider, body.op, body.key, body.contentType)
    return json(signed, 200, cors)
  } catch (e) {
    if (e instanceof HttpError) {
      return json({ error: e.message }, e.status, cors)
    }
    return json(
      { error: e instanceof Error ? e.message : 'internal error' },
      500,
      cors,
    )
  }
})
