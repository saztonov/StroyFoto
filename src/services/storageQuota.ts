/**
 * Мониторинг квоты IndexedDB. Проверяет через navigator.storage.estimate()
 * и dispatch'ит событие при превышении порога.
 */

const QUOTA_WARNING_THRESHOLD = 0.85

export interface QuotaInfo {
  usageMB: number
  quotaMB: number
  percentUsed: number
}

export async function checkStorageQuota(): Promise<QuotaInfo | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const est = await navigator.storage.estimate()
    if (!est.usage || !est.quota) return null
    const usageMB = est.usage / (1024 * 1024)
    const quotaMB = est.quota / (1024 * 1024)
    const percentUsed = est.usage / est.quota
    return { usageMB, quotaMB, percentUsed }
  } catch {
    return null
  }
}

export async function warnIfQuotaHigh(): Promise<void> {
  const info = await checkStorageQuota()
  if (!info || info.percentUsed < QUOTA_WARNING_THRESHOLD) return
  window.dispatchEvent(new CustomEvent('stroyfoto:storage-warning', {
    detail: { percent: Math.round(info.percentUsed * 100) },
  }))
}
