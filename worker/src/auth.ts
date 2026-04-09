import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

interface JwksCacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>
  fetchedAt: number
}

const cache = new Map<string, JwksCacheEntry>()
const TTL_MS = 10 * 60 * 1000

function getJwks(supabaseUrl: string) {
  const existing = cache.get(supabaseUrl)
  if (existing && Date.now() - existing.fetchedAt < TTL_MS) return existing.jwks
  const jwks = createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
  )
  cache.set(supabaseUrl, { jwks, fetchedAt: Date.now() })
  return jwks
}

export interface VerifiedUser {
  sub: string
  payload: JWTPayload
  rawToken: string
}

/**
 * Проверяет Supabase access JWT. Поддерживает оба варианта:
 *   - HS256 с симметричным секретом (legacy Supabase) — НЕ используется здесь,
 *     потому что секрет должен оставаться на сервере Supabase. Поэтому только
 *     RS256 / ES256 через публичный JWKS endpoint.
 *
 * Если ваш проект Supabase ещё на HS256, переключите его на ассиметричную
 * подпись (Project Settings → API → JWT Signing Keys → Use new asymmetric keys).
 */
export async function verifyJwt(
  authHeader: string | null,
  supabaseUrl: string,
): Promise<VerifiedUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'missing bearer token')
  }
  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) throw new HttpError(401, 'empty token')

  try {
    const jwks = getJwks(supabaseUrl)
    const { payload } = await jwtVerify(token, jwks, {
      // Supabase issuer формата https://<ref>.supabase.co/auth/v1
      issuer: `${supabaseUrl}/auth/v1`,
    })
    if (!payload.sub) throw new HttpError(401, 'token missing sub')
    return { sub: payload.sub, payload, rawToken: token }
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(401, `jwt verify failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
