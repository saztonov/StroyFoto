import { supabase } from '@/lib/supabase'
import { getDB, type SyncOp } from '@/lib/db'
import {
  countPendingReports,
  markReportSyncedIfComplete,
  updateReportStatus,
} from '@/services/localReports'
import { deleteRemotePhoto, markPhotoSynced, uploadPhoto } from '@/services/photos'
import { replaceRemotePlanMark } from '@/services/reports'
import { applyRetention } from '@/services/retention'
import { warnIfQuotaHigh } from '@/services/storageQuota'
import { emitReportsChanged } from '@/services/invalidation'
import { reconcile } from '@/services/reconcile'

// ---------------------------------------------------------------------------
// Классификация ошибок: transient → retry, auth → refresh + retry,
// permanent → fail immediately (без retry-storm).
// ---------------------------------------------------------------------------

type ErrorClass = 'transient' | 'auth' | 'permanent'

interface SupabaseError {
  code?: string
  message?: string
  status?: number
  statusCode?: number
}

function isDuplicateKey(err: SupabaseError): boolean {
  return err.code === '23505' || /duplicate key|23505/i.test(err.message ?? '')
}

function classifyError(err: SupabaseError): ErrorClass {
  const code = err.code ?? ''
  const msg = (err.message ?? '').toLowerCase()
  const status = err.status ?? err.statusCode ?? 0

  // Auth errors — refresh token and retry
  if (status === 401 || /jwt expired|not authenticated|invalid.*token/i.test(msg)) {
    return 'auth'
  }

  // Permanent errors — don't retry, fail immediately with readable message
  if (status === 403 || /forbidden|rls|row.level.security/i.test(msg)) return 'permanent'
  if (/^2[23]\d{3}$/.test(code) && code !== '23505') return 'permanent' // FK, unique (except dup key), check violations
  if (/violates.*constraint|foreign key|check constraint/i.test(msg)) return 'permanent'
  if (status === 400 || status === 422) return 'permanent' // validation

  // Everything else is transient (network, timeout, 5xx)
  return 'transient'
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

interface SyncSnapshot {
  state: SyncState
  pending: number
  failed: number
  lastError: string | null
}

let snapshot: SyncSnapshot = { state: 'idle', pending: 0, failed: 0, lastError: null }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot
}

export function subscribeSync(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function setSnapshot(patch: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...patch }
  emit()
}

let timer: ReturnType<typeof setInterval> | null = null
let running = false
let started = false

async function refreshPending() {
  // Агрегация: отчёт "в работе", если у него failed-статус ИЛИ есть хоть одна
  // задача в sync_queue. countPendingReports() инкапсулирует эту логику.
  const db = await getDB()
  const reports = await db.getAll('reports')
  const pending = await countPendingReports()
  const failed = reports.filter((r) => r.syncStatus === 'failed').length
  setSnapshot({ pending, failed })
}

function backoffMs(attempts: number) {
  const base = Math.min(60_000, Math.pow(2, attempts) * 1000)
  return base + Math.floor(Math.random() * 500)
}

interface ProcessResult {
  done: boolean
  error?: string
  errorCode?: string
  errorStatus?: number
}

async function processOp(op: SyncOp): Promise<ProcessResult> {
  const db = await getDB()

  if (op.kind === 'photo') {
    const photo = await db.get('photos', op.entityId)
    if (!photo) return { done: true }
    if (photo.origin === 'remote') return { done: true }
    if (photo.syncStatus === 'synced') return { done: true }
    try {
      const { r2Key, thumbR2Key } = await uploadPhoto(photo)
      await markPhotoSynced(photo.id, r2Key, thumbR2Key)
      return { done: true }
    } catch (e) {
      return { done: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (op.kind === 'report') {
    const report = await db.get('reports', op.entityId)
    if (!report) return { done: true }
    const payload = {
      id: report.id,
      project_id: report.projectId,
      work_type_id: report.workTypeId,
      performer_id: report.performerId,
      work_assignment_id: report.workAssignmentId,
      plan_id: report.planId,
      author_id: report.authorId,
      description: report.description,
      taken_at: report.takenAt,
    }
    // INSERT вместо upsert: upsert + RLS с подзапросами к той же таблице
    // вызывает 500 на PostgREST. При повторной синхронизации (retry)
    // row уже существует → 23505 (duplicate key), это ОК — считаем done.
    const { error } = await supabase.from('reports').insert(payload)
    if (error) {
      if (isDuplicateKey(error)) return { done: true }
      return { done: false, error: error.message, errorCode: error.code, errorStatus: (error as SupabaseError).status }
    }
    return { done: true }
  }

  if (op.kind === 'mark') {
    const mark = await db.get('plan_marks', op.entityId)
    if (!mark) return { done: true }
    const { error } = await supabase.from('report_plan_marks').insert({
      report_id: mark.reportId,
      plan_id: mark.planId,
      page: mark.page,
      x_norm: mark.xNorm,
      y_norm: mark.yNorm,
    })
    if (error && !isDuplicateKey(error)) {
      return { done: false, error: error.message, errorCode: error.code, errorStatus: (error as SupabaseError).status }
    }
    return { done: true }
  }

  if (op.kind === 'report_update') {
    const mutation = await db.get('report_mutations', Number(op.entityId))
    if (!mutation) return { done: true }
    if (!mutation.payload) return { done: true }
    const updatePayload: Record<string, unknown> = {
      work_type_id: mutation.payload.workTypeId,
      performer_id: mutation.payload.performerId,
      work_assignment_id: mutation.payload.workAssignmentId,
      description: mutation.payload.description,
      taken_at: mutation.payload.takenAt,
    }
    if (mutation.payload.planId !== undefined) {
      updatePayload.plan_id = mutation.payload.planId
    }
    const { data, error } = await supabase
      .from('reports')
      .update(updatePayload)
      .eq('id', mutation.reportId)
      .eq('updated_at', mutation.baseUpdatedAt)
      .select('id')
    if (error) {
      return { done: false, error: error.message, errorCode: error.code, errorStatus: (error as SupabaseError).status }
    }
    if (!data || data.length === 0) {
      // Конфликт: отчёт изменён другим пользователем — permanent fail
      await db.delete('report_mutations', mutation.id!)
      return { done: true }
    }
    await db.delete('report_mutations', mutation.id!)
    return { done: true }
  }

  if (op.kind === 'report_delete') {
    const mutation = await db.get('report_mutations', Number(op.entityId))
    if (!mutation) return { done: true }
    const { error } = await supabase.from('reports').delete().eq('id', mutation.reportId)
    if (error) {
      // Если отчёт уже удалён — считаем успехом
      if (/not found|no rows/i.test(error.message)) {
        await db.delete('report_mutations', mutation.id!)
        return { done: true }
      }
      return { done: false, error: error.message, errorCode: error.code, errorStatus: (error as SupabaseError).status }
    }
    await db.delete('report_mutations', mutation.id!)
    return { done: true }
  }

  if (op.kind === 'photo_delete') {
    const rec = await db.get('photo_deletes', op.entityId)
    if (!rec) return { done: true }
    try {
      await deleteRemotePhoto(rec.id, rec.reportId, rec.r2Key, rec.thumbR2Key)
      await db.delete('photo_deletes', rec.id)
      // Удаляем локальный blob (если был кэш)
      try { await db.delete('photos', rec.id) } catch { /* нет в кэше */ }
      return { done: true }
    } catch (e) {
      return { done: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (op.kind === 'mark_update') {
    const rec = await db.get('mark_updates', op.entityId)
    if (!rec) return { done: true }
    try {
      const mark = rec.planId && rec.page != null && rec.xNorm != null && rec.yNorm != null
        ? { planId: rec.planId, page: rec.page, xNorm: rec.xNorm, yNorm: rec.yNorm }
        : null
      await replaceRemotePlanMark(rec.reportId, mark)
      await db.delete('mark_updates', rec.reportId)
      // Обновляем локальный plan_marks store
      if (mark) {
        await db.put('plan_marks', {
          reportId: rec.reportId,
          planId: mark.planId,
          page: mark.page,
          xNorm: mark.xNorm,
          yNorm: mark.yNorm,
          syncStatus: 'synced' as const,
        })
      } else {
        try { await db.delete('plan_marks', rec.reportId) } catch { /* может не быть */ }
      }
      return { done: true }
    } catch (e) {
      return { done: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (op.kind === 'work_type') {
    // Локальный work_type, созданный офлайн. После появления сети вставляем
    // его в Supabase с тем же UUID — клиент уже ссылается на этот id в отчёте.
    // Если на сервере уже есть запись с таким name (citext unique) — Supabase
    // вернёт 23505; это нормально, работа с дубликатами решается на клиенте
    // через сверку по name, а мы просто помечаем операцию завершённой.
    const local = await db.get('work_types_local', op.entityId)
    if (!local) return { done: true }
    const { error } = await supabase.from('work_types').upsert(
      { id: local.id, name: local.name, is_active: true },
      { onConflict: 'id' },
    )
    if (error && !isDuplicateKey(error)) {
      return { done: false, error: error.message, errorCode: error.code, errorStatus: (error as SupabaseError).status }
    }
    local.syncStatus = 'synced'
    await db.put('work_types_local', local)
    return { done: true }
  }

  if (op.kind === 'work_assignment') {
    // Симметрично work_type: офлайн-черновик назначения работ → upsert по id
    // на сервере. Дубликат по name (citext unique) обрабатывается так же —
    // 23505 не считается ошибкой, операция помечается завершённой.
    const local = await db.get('work_assignments_local', op.entityId)
    if (!local) return { done: true }
    const { error } = await supabase.from('work_assignments').upsert(
      { id: local.id, name: local.name, is_active: true },
      { onConflict: 'id' },
    )
    if (error && !isDuplicateKey(error)) {
      return { done: false, error: error.message, errorCode: error.code, errorStatus: (error as SupabaseError).status }
    }
    local.syncStatus = 'synced'
    await db.put('work_assignments_local', local)
    return { done: true }
  }

  return { done: true }
}

async function tick() {
  if (running) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSnapshot({ state: 'offline' })
    return
  }
  running = true
  setSnapshot({ state: 'syncing' })
  try {
    const db = await getDB()
    while (true) {
      const all = await db.getAll('sync_queue')
      const now = Date.now()
      const next = all
        .filter((o) => o.nextAttemptAt <= now)
        .sort((a, b) => {
          // work_type/work_assignment → report → mark → photo. Справочники
          // идут первыми, потому что отчёт может ссылаться на их локальные id.
          const order: Record<string, number> = { work_type: 0, work_assignment: 0, report: 1, report_update: 1, report_delete: 1, mark: 2, mark_update: 2, photo: 3, photo_delete: 4 }
          return order[a.kind] - order[b.kind] || a.nextAttemptAt - b.nextAttemptAt
        })[0]
      if (!next) break

      const result = await processOp(next)
      if (result.done) {
        if (next.id != null) await db.delete('sync_queue', next.id)
        // После успеха проверяем, можно ли агрегированно пометить отчёт synced.
        const rid = next.reportId ?? (next.kind === 'report' || next.kind === 'mark' ? next.entityId : null)
        if (rid) await markReportSyncedIfComplete(rid)
      } else {
        // Классифицируем ошибку: transient → retry, auth → refresh, permanent → fail
        const errClass = classifyError({
          message: result.error,
          code: result.errorCode,
          status: result.errorStatus,
        })

        if (errClass === 'auth') {
          // Токен протух — пробуем обновить и повторить немедленно
          const { error: refreshError } = await supabase.auth.refreshSession()
          if (refreshError) {
            setSnapshot({ state: 'error', lastError: 'Сессия истекла. Войдите заново.' })
            break
          }
          // Сбрасываем backoff, повторяем эту операцию немедленно
          next.nextAttemptAt = Date.now()
          if (next.id != null) await db.put('sync_queue', next)
          continue
        }

        if (errClass === 'permanent') {
          // Permanent-ошибка: не ретраим, сразу fail
          if (next.id != null) await db.delete('sync_queue', next.id)
          const rid = next.reportId ?? (next.kind === 'report' || next.kind === 'mark' ? next.entityId : null)
          if (rid) {
            await updateReportStatus(rid, 'failed', result.error ?? 'Постоянная ошибка')
          }
          setSnapshot({ lastError: result.error ?? null })
          continue // переходим к следующей операции, не ломаем весь цикл
        }

        // Transient — стандартный retry с backoff
        next.attempts += 1
        next.lastError = result.error ?? 'unknown'
        next.nextAttemptAt = Date.now() + backoffMs(next.attempts)
        if (next.id != null) {
          try {
            await db.put('sync_queue', next)
          } catch (e) {
            console.error('sync_queue put failed, id=', next.id, 'obj keys:', Object.keys(next), e)
            throw e
          }
        }
        if (next.kind === 'report') {
          await updateReportStatus(
            next.entityId,
            next.attempts >= 5 ? 'failed' : 'pending',
            result.error ?? null,
          )
        } else {
          const rid = next.reportId
          if (rid) {
            await updateReportStatus(rid, next.attempts >= 5 ? 'failed' : 'pending', result.error ?? null)
          }
        }
        setSnapshot({ lastError: result.error ?? null })
        break // transient error — не долбим сеть подряд
      }
    }
    setSnapshot({ state: 'idle' })
    // После успешного push уведомляем UI и другие вкладки.
    emitReportsChanged()
  } catch (e) {
    setSnapshot({ state: 'error', lastError: e instanceof Error ? e.message : String(e) })
  } finally {
    running = false
    await refreshPending()
    // После каждого цикла применяем device-level retention. Важно: эта функция
    // удаляет ТОЛЬКО synced-записи БЕЗ открытых задач в sync_queue, так что
    // несинхронизированные данные никогда не будут потеряны.
    void applyRetention().catch(() => undefined)
    void warnIfQuotaHigh().catch(() => undefined)
  }
}

export function triggerSync() {
  void tick()
}

/** Запускает один цикл синхронизации и ждёт его завершения. */
export async function runSyncOnce(): Promise<void> {
  await tick()
}

function handleOnline() {
  setSnapshot({ state: 'idle' })
  triggerSync()
  // Лёгкий pull свежих данных с сервера после восстановления сети
  void reconcile().catch(() => undefined)
}
function handleOffline() {
  setSnapshot({ state: 'offline' })
}
function handleVisibility() {
  if (document.visibilityState === 'visible') {
    triggerSync()
    // При возврате в приложение тоже подтягиваем свежие данные
    void reconcile().catch(() => undefined)
  }
}

export function startSyncLoop() {
  if (started) return
  started = true
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)
  // На скрытой вкладке/в фоне опрашиваем реже — экономим батарею мобильного устройства.
  const scheduleTick = () => {
    if (timer) clearInterval(timer)
    const interval = typeof document !== 'undefined' && document.hidden ? 120_000 : 30_000
    timer = setInterval(triggerSync, interval)
  }
  scheduleTick()
  document.addEventListener('visibilitychange', scheduleTick)
  void refreshPending()
  triggerSync()
}

export function stopSyncLoop() {
  if (!started) return
  started = false
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  document.removeEventListener('visibilitychange', handleVisibility)
  if (timer) clearInterval(timer)
  timer = null
}
