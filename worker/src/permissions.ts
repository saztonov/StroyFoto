import { HttpError, type VerifiedUser } from './auth'
import type { ParsedKey } from './keys'

interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

interface CheckArgs {
  env: Env
  user: VerifiedUser
  parsed: ParsedKey
  op: 'put' | 'get' | 'delete'
  bodyReportId?: string
  bodyProjectId?: string
  bodyPlanId?: string
}

/**
 * Все проверки прав делегируются Supabase RLS: Worker делает GET в PostgREST с
 * клиентским JWT. Если RLS не пускает — приходит пустой массив, и мы 403'им.
 * Никакого service_role в Worker.
 */
export async function checkAccess(args: CheckArgs): Promise<void> {
  const { parsed, bodyReportId, bodyProjectId, bodyPlanId } = args

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

async function checkPhotoAccess(args: CheckArgs, reportId: string): Promise<void> {
  const { env, user, op } = args
  const url = `${env.SUPABASE_URL}/rest/v1/reports?id=eq.${encodeURIComponent(
    reportId,
  )}&select=id,project_id,author_id`
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${user.rawToken}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new HttpError(502, `supabase ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const rows = (await res.json()) as Array<{ id: string; project_id: string; author_id: string }>
  if (!rows.length) throw new HttpError(403, 'нет доступа к отчёту')

  const row = rows[0]
  if (op === 'put' || op === 'delete') {
    if (row.author_id !== user.sub) {
      throw new HttpError(403, 'только автор может загружать или удалять фото отчёта')
    }
  }
}

async function checkPlanAccess(
  args: CheckArgs,
  projectId: string,
  planId: string,
): Promise<void> {
  const { env, user, op } = args

  if (op === 'put' || op === 'delete') {
    // Только админ может загружать/удалять планы.
    const profUrl = `${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(
      user.sub,
    )}&select=role,is_active`
    const profRes = await fetch(profUrl, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${user.rawToken}`,
        Accept: 'application/json',
      },
    })
    if (!profRes.ok) throw new HttpError(502, `supabase profiles ${profRes.status}`)
    const profs = (await profRes.json()) as Array<{ role: string; is_active: boolean }>
    if (!profs.length || profs[0].role !== 'admin' || !profs[0].is_active) {
      throw new HttpError(403, 'только активный администратор может управлять планами')
    }

    // Дополнительно — проверим, что проект существует и видим текущему JWT.
    const projUrl = `${env.SUPABASE_URL}/rest/v1/projects?id=eq.${encodeURIComponent(
      projectId,
    )}&select=id`
    const projRes = await fetch(projUrl, {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${user.rawToken}`,
        Accept: 'application/json',
      },
    })
    if (!projRes.ok) throw new HttpError(502, `supabase projects ${projRes.status}`)
    const projs = (await projRes.json()) as Array<{ id: string }>
    if (!projs.length) throw new HttpError(403, 'проект недоступен')
    return
  }

  // op === 'get' → членство в проекте достаточно. Если запись plan видна — RLS уже всё проверил.
  const plansUrl = `${env.SUPABASE_URL}/rest/v1/plans?id=eq.${encodeURIComponent(
    planId,
  )}&select=id,project_id`
  const plansRes = await fetch(plansUrl, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${user.rawToken}`,
      Accept: 'application/json',
    },
  })
  if (!plansRes.ok) throw new HttpError(502, `supabase plans ${plansRes.status}`)
  const plans = (await plansRes.json()) as Array<{ id: string; project_id: string }>
  if (!plans.length) throw new HttpError(403, 'нет доступа к плану')
  if (plans[0].project_id !== projectId) {
    throw new HttpError(400, 'projectId в теле не совпадает с фактическим планом')
  }
}
