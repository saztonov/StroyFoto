import { supabase } from '@/lib/supabase'
import { getDB, type SyncOp } from '@/lib/db'
import { updateReportStatus } from '@/services/localReports'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

interface SyncSnapshot {
  state: SyncState
  pending: number
  lastError: string | null
}

let snapshot: SyncSnapshot = { state: 'idle', pending: 0, lastError: null }
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
  const db = await getDB()
  const all = await db.getAll('reports')
  const pending = all.filter(
    (r) => r.syncStatus === 'pending' || r.syncStatus === 'failed' || r.syncStatus === 'syncing',
  ).length
  setSnapshot({ pending })
}

function backoffMs(attempts: number) {
  const base = Math.min(60_000, Math.pow(2, attempts) * 1000)
  return base + Math.floor(Math.random() * 500)
}

async function processOp(op: SyncOp): Promise<{ done: boolean; error?: string }> {
  if (op.kind === 'photo') {
    // Фото пока не выгружаем — ждём presign endpoint. Считаем "сделано", чтобы
    // не крутить очередь, но саму запись фото оставляем со статусом pending_upload.
    return { done: true }
  }

  const db = await getDB()

  if (op.kind === 'report') {
    const report = await db.get('reports', op.entityId)
    if (!report) return { done: true }
    const { error } = await supabase.from('reports').upsert(
      {
        id: report.id,
        project_id: report.projectId,
        work_type_id: report.workTypeId,
        performer_id: report.performerId,
        plan_id: report.planId,
        author_id: report.authorId,
        description: report.description,
        taken_at: report.takenAt,
      },
      { onConflict: 'id' },
    )
    if (error) return { done: false, error: error.message }
    await updateReportStatus(report.id, 'synced')
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
          // report → mark → photo
          const order = { report: 0, mark: 1, photo: 2 } as const
          return order[a.kind] - order[b.kind] || a.nextAttemptAt - b.nextAttemptAt
        })[0]
      if (!next) break

      const result = await processOp(next)
      if (result.done) {
        if (next.id != null) await db.delete('sync_queue', next.id)
      } else {
        next.attempts += 1
        next.lastError = result.error ?? 'unknown'
        next.nextAttemptAt = Date.now() + backoffMs(next.attempts)
        if (next.id != null) await db.put('sync_queue', next)
        if (next.kind === 'report') {
          await updateReportStatus(
            next.entityId,
            next.attempts >= 5 ? 'failed' : 'pending',
            result.error ?? null,
          )
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
  timer = setInterval(triggerSync, 30_000)
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
