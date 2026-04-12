/** Реактивный стор состояния обновления PWA. */

let updateAvailable = false
const listeners = new Set<() => void>()

// --- useSyncExternalStore API ---

export function getUpdateSnapshot(): boolean {
  return updateAvailable
}

export function subscribeUpdate(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// --- Вызывается из main.tsx ---

/** Сигнал: новая версия SW готова, нужна перезагрузка. */
export function setUpdateAvailable(): void {
  updateAvailable = true
  for (const l of listeners) l()
}

let _updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null

/** Сохраняет функцию перезагрузки, возвращённую registerSW. */
export function setUpdateSW(fn: (reloadPage?: boolean) => Promise<void>): void {
  _updateSW = fn
}

/** Применить обновление — перезагрузить страницу с новой версией. */
export function applyUpdate(): void {
  void _updateSW?.(true)
}
