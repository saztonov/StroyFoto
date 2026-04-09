import { HttpError, verifyJwt } from './auth'
import { parseKey, type Kind } from './keys'
import { checkAccess } from './permissions'
import { presignR2 } from './sign'

export interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  R2_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET: string
  ALLOWED_ORIGINS: string
}

interface SignBody {
  op: 'put' | 'get' | 'delete'
  kind: Kind
  key: string
  reportId?: string
  projectId?: string
  planId?: string
  contentType?: string
}

const ALLOWED_CT = new Set(['image/jpeg', 'application/pdf'])

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin')
    const corsHeaders = buildCors(origin, env)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(req.url)
    if (req.method !== 'POST' || url.pathname !== '/sign') {
      return json({ error: 'not found' }, 404, corsHeaders)
    }

    try {
      const body = (await req.json()) as SignBody
      validateBody(body)

      const user = await verifyJwt(req.headers.get('Authorization'), env.SUPABASE_URL)

      const parsed = parseKey(body.kind, body.key)
      if (!parsed) throw new HttpError(400, 'некорректный object key')

      await checkAccess({
        env,
        user,
        parsed,
        op: body.op,
        bodyReportId: body.reportId,
        bodyProjectId: body.projectId,
        bodyPlanId: body.planId,
      })

      const signed = await presignR2(env, body.op, body.key, body.contentType)
      return json(signed, 200, corsHeaders)
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: e.message }, e.status, corsHeaders)
      }
      return json(
        { error: e instanceof Error ? e.message : 'internal error' },
        500,
        corsHeaders,
      )
    }
  },
}

function validateBody(b: SignBody): void {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'bad body')
  if (!['put', 'get', 'delete'].includes(b.op)) throw new HttpError(400, 'bad op')
  if (!['photo', 'photo_thumb', 'plan'].includes(b.kind)) throw new HttpError(400, 'bad kind')
  if (typeof b.key !== 'string' || b.key.length > 256) throw new HttpError(400, 'bad key')
  if (b.op === 'put') {
    if (!b.contentType || !ALLOWED_CT.has(b.contentType)) {
      throw new HttpError(400, 'contentType должен быть image/jpeg или application/pdf')
    }
  }
}

function buildCors(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? ''
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
