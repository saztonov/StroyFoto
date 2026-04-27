/**
 * Единый invalidation hub для межпользовательских и кросс-табных обновлений.
 *
 * Источники событий:
 *  1. Supabase Realtime — postgres_changes на таблицы reports, photos, marks,
 *     plans, catalogs, project_memberships
 *  2. BroadcastChannel — синхронизация между вкладками одного браузера
 *  3. Локальный sync loop — вызывает emitReportsChanged() после push'а
 *
 * Graceful degradation: при ошибке Realtime-канала логируем предупреждение;
 * существующий 30s sync polling в sync.ts остаётся safety net.
 */

import { supabase } from '@/lib/supabase'
import { getDB } from '@/lib/db'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Listener sets
// ---------------------------------------------------------------------------

type VoidCb = () => void
type ReportEventCb = (event: 'update' | 'delete') => void

const reportsListeners = new Set<VoidCb>()
const reportListeners = new Map<string, Set<ReportEventCb>>()
const catalogsListeners = new Set<VoidCb>()
const plansListeners = new Set<VoidCb>()

function fireReports() {
  for (const cb of reportsListeners) cb()
}
function fireReport(id: string, event: 'update' | 'delete') {
  const set = reportListeners.get(id)
  if (set) for (const cb of set) cb(event)
}
function fireCatalogs() {
  for (const cb of catalogsListeners) cb()
}
function firePlans() {
  for (const cb of plansListeners) cb()
}

// ---------------------------------------------------------------------------
// Public subscriptions
// ---------------------------------------------------------------------------

export function onReportsChanged(cb: VoidCb): VoidCb {
  reportsListeners.add(cb)
  return () => reportsListeners.delete(cb)
}

export function onReportChanged(id: string, cb: ReportEventCb): VoidCb {
  if (!reportListeners.has(id)) reportListeners.set(id, new Set())
  reportListeners.get(id)!.add(cb)
  return () => {
    const set = reportListeners.get(id)
    if (set) {
      set.delete(cb)
      if (set.size === 0) reportListeners.delete(id)
    }
  }
}

export function onCatalogsChanged(cb: VoidCb): VoidCb {
  catalogsListeners.add(cb)
  return () => catalogsListeners.delete(cb)
}

export function onPlansChanged(cb: VoidCb): VoidCb {
  plansListeners.add(cb)
  return () => plansListeners.delete(cb)
}

/** Вызывается из sync loop после успешного push операции. */
export function emitReportsChanged(): void {
  fireReports()
  broadcastToOtherTabs({ type: 'reportsChanged' })
}

export function emitReportChanged(id: string, event: 'update' | 'delete'): void {
  fireReport(id, event)
  broadcastToOtherTabs({ type: 'reportChanged', id, event })
}

export function emitCatalogsChanged(): void {
  fireCatalogs()
  broadcastToOtherTabs({ type: 'catalogsChanged' })
}

export function emitPlansChanged(): void {
  firePlans()
  broadcastToOtherTabs({ type: 'plansChanged' })
}

// ---------------------------------------------------------------------------
// BroadcastChannel — кросс-табная синхронизация
// ---------------------------------------------------------------------------

interface BcMessage {
  type: 'reportsChanged' | 'reportChanged' | 'catalogsChanged' | 'plansChanged'
  id?: string
  event?: 'update' | 'delete'
}

let bc: BroadcastChannel | null = null

function initBroadcastChannel(): void {
  if (typeof BroadcastChannel === 'undefined') return
  bc = new BroadcastChannel('stroyfoto-invalidation')
  bc.onmessage = (ev: MessageEvent<BcMessage>) => {
    const msg = ev.data
    if (msg.type === 'reportsChanged') fireReports()
    else if (msg.type === 'reportChanged' && msg.id && msg.event) fireReport(msg.id, msg.event)
    else if (msg.type === 'catalogsChanged') fireCatalogs()
    else if (msg.type === 'plansChanged') firePlans()
  }
}

function broadcastToOtherTabs(msg: BcMessage): void {
  try {
    bc?.postMessage(msg)
  } catch {
    // BroadcastChannel может быть закрыт
  }
}

// ---------------------------------------------------------------------------
// Supabase Realtime
// ---------------------------------------------------------------------------

let channel: RealtimeChannel | null = null
let currentUserId: string | null = null

async function isOwnPendingReport(reportId: string, authorId: string): Promise<boolean> {
  if (authorId !== currentUserId) return false
  try {
    const db = await getDB()
    const local = await db.get('reports', reportId)
    return local != null && local.syncStatus !== 'synced'
  } catch {
    return false
  }
}

function initRealtimeChannel(userId: string): void {
  // Офлайн — не создаём WebSocket, он будет бесконечно реконнектиться.
  // При возвращении сети AuthProvider вызовет startInvalidation() повторно.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return

  // Защита от дублирования: если канал уже создан для этого пользователя — не пересоздаём.
  if (channel && currentUserId === userId) return

  // Очистка старого канала при смене пользователя.
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }

  currentUserId = userId

  channel = supabase
    .channel('stroyfoto-changes')
    // Отчёты
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reports' },
      async (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | undefined
        const reportId = row?.id as string | undefined
        const authorId = row?.author_id as string | undefined

        // Фильтруем собственные pending-изменения — sync loop уже обновит UI
        if (reportId && authorId && await isOwnPendingReport(reportId, authorId)) return

        if (payload.eventType === 'DELETE' && reportId) {
          fireReport(reportId, 'delete')
        } else if (reportId) {
          fireReport(reportId, 'update')
        }
        fireReports()
      },
    )
    // Фото отчётов
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'report_photos' },
      (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | undefined
        const reportId = (row?.report_id as string) ?? undefined
        if (reportId) fireReport(reportId, 'update')
        fireReports()
      },
    )
    // Метки на планах
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'report_plan_marks' },
      (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | undefined
        const reportId = (row?.report_id as string) ?? undefined
        if (reportId) fireReport(reportId, 'update')
        fireReports()
      },
    )
    // Планы
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'plans' },
      () => firePlans(),
    )
    // Справочники
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'work_types' },
      () => fireCatalogs(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'performers' },
      () => fireCatalogs(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'work_assignments' },
      () => fireCatalogs(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'projects' },
      () => { fireCatalogs(); fireReports() },
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'project_memberships' },
      () => { fireCatalogs(); fireReports() },
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[realtime] channel error, falling back to polling:', err)
      }
    })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let onlineHandler: (() => void) | null = null

export function startInvalidation(userId: string): void {
  initBroadcastChannel()
  initRealtimeChannel(userId)

  // При возвращении сети — создаём Realtime-канал, если его ещё нет.
  if (!onlineHandler) {
    onlineHandler = () => {
      if (currentUserId) initRealtimeChannel(currentUserId)
    }
    window.addEventListener('online', onlineHandler)
  }
}

export function stopInvalidation(): void {
  if (channel) {
    supabase.removeChannel(channel)
    channel = null
  }
  currentUserId = null
  if (bc) {
    bc.close()
    bc = null
  }
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler)
    onlineHandler = null
  }
}
