/**
 * Единый invalidation hub для кросс-табных обновлений.
 *
 * Источники событий:
 *  1. BroadcastChannel — синхронизация между вкладками одного браузера
 *  2. Локальный sync loop — вызывает emitReportsChanged() после push'а
 *
 * Серверный push (WebSocket / SSE / LISTEN-NOTIFY) пока не реализован:
 * invalidation работает через polling sync (30/120с) + reconcile() при
 * `online`/`visibilitychange` + BroadcastChannel.
 */

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
  if (bc) return
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
// Lifecycle
// ---------------------------------------------------------------------------

export function startInvalidation(_userId: string): void {
  initBroadcastChannel()
}

export function stopInvalidation(): void {
  if (bc) {
    bc.close()
    bc = null
  }
}
