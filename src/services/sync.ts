import { supabase } from '@/lib/supabase'
import { getDB, type SyncOp } from '@/lib/db'
import {
  countPendingReports,
  markReportSyncedIfComplete,
  updateReportStatus,
} from '@/services/localReports'
import { markPhotoSynced, uploadPhoto } from '@/services/photos'
import { applyRetention } from '@/services/retention'

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

async function processOp(op: SyncOp): Promise<{ done: boolean; error?: string }> {
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
      if (/duplicate key|23505/i.test(error.message)) return { done: true }
      return { done: false, error: error.message }
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
    if (error && !/duplicate key/i.test(error.message)) {
      return { done: false, error: error.message }
    }
    return { done: true }
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
    if (error && !/duplicate key|23505/i.test(error.message)) {
      return { done: false, error: error.message }
    }
    local.syncStatus = 'synced'
    await db.put('work_types_local', local)
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
          // work_type → report → mark → photo. work_type идёт первым,
          // потому что отчёт может ссылаться на локальный work_type.id.
          const order = { work_type: 0, report: 1, mark: 2, photo: 3 } as const
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
          // Ошибка на photo/mark/work_type — отметим сам отчёт как pending
          // с описанием ошибки, чтобы UI показал проблему и ручная кнопка
          // могла повторно дёрнуть цикл.
          const rid = next.reportId
          if (rid) {
            await updateReportStatus(rid, next.attempts >= 5 ? 'failed' : 'pending', result.error ?? null)
          }
        }
        setSnapshot({ lastError: result.error ?? null })
        break // не долбим сеть подряд
      }
    }
    setSnapshot({ state: 'idle' })
  } catch (e) {
    setSnapshot({ state: 'error', lastError: e instanceof Error ? e.message : String(e) })
  } finally {
    running = false
    await refreshPending()
    // После каждого цикла применяем device-level retention. Важно: эта функция
    // удаляет ТОЛЬКО synced-записи БЕЗ открытых задач в sync_queue, так что
    // несинхронизированные данные никогда не будут потеряны.
    void applyRetention().catch(() => undefined)
  }
}

export function triggerSync() {
  void tick()
}

function handleOnline() {
  setSnapshot({ state: 'idle' })
  triggerSync()
}
function handleOffline() {
  setSnapshot({ state: 'offline' })
}
function handleVisibility() {
  if (document.visibilityState === 'visible') triggerSync()
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
