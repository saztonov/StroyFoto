/**
 * Очистка пользовательских данных в IDB при logout/смене userId.
 *
 * Зачем: sync_queue, report_mutations и другие per-user stores содержат
 * операции конкретного пользователя. Если они останутся при logout и
 * на устройстве зайдёт другой user, sync-loop отправит чужие операции
 * под новой сессией → cross-user data leak / 403 / FK violation.
 *
 * Что НЕ удаляем при стандартном logout: catalogs, plans_cache,
 * remote_reports_cache, device_settings — это безопасный кэш справочников
 * и устройств. При смене userId (другой пользователь зашёл на то же
 * устройство) их тоже надо чистить — есть отдельный wipeAllUserData.
 */

import { getDB } from '@/lib/db'

export interface LogoutWipeStats {
  reportsRemoved: number
  photosRemoved: number
  syncQueueRemoved: number
  reportMutationsRemoved: number
  photoDeletesRemoved: number
  markUpdatesRemoved: number
  workTypesLocalRemoved: number
  workAssignmentsLocalRemoved: number
  syncIssuesRemoved: number
}

/**
 * Удаляет локальные несинхронизированные данные текущего пользователя.
 * Используется при logout (с подтверждением, если есть pending) и при
 * автоматическом обнаружении смены userId.
 */
export async function wipePendingUserData(): Promise<LogoutWipeStats> {
  const db = await getDB()
  const stats: LogoutWipeStats = {
    reportsRemoved: 0,
    photosRemoved: 0,
    syncQueueRemoved: 0,
    reportMutationsRemoved: 0,
    photoDeletesRemoved: 0,
    markUpdatesRemoved: 0,
    workTypesLocalRemoved: 0,
    workAssignmentsLocalRemoved: 0,
    syncIssuesRemoved: 0,
  }

  const tx = db.transaction(
    [
      'reports',
      'photos',
      'plan_marks',
      'sync_queue',
      'report_mutations',
      'photo_deletes',
      'mark_updates',
      'work_types_local',
      'work_assignments_local',
      'sync_issues',
    ],
    'readwrite',
  )

  // 1. Локальные не synced отчёты — удаляем (вместе со связанными blob'ами).
  const reports = await tx.objectStore('reports').getAll()
  const localReportIds = new Set<string>()
  for (const r of reports) {
    if (r.syncStatus !== 'synced') {
      localReportIds.add(r.id)
      await tx.objectStore('reports').delete(r.id)
      stats.reportsRemoved++
    }
  }

  // 2. Photos: удаляем local-origin (не synced ещё) И все связанные с
  // не-synced отчётами выше.
  const photos = await tx.objectStore('photos').getAll()
  for (const p of photos) {
    if (p.origin === 'local' || localReportIds.has(p.reportId)) {
      await tx.objectStore('photos').delete(p.id)
      stats.photosRemoved++
    }
  }

  // 3. plan_marks для удалённых reports.
  const marks = await tx.objectStore('plan_marks').getAll()
  for (const m of marks) {
    if (localReportIds.has(m.reportId)) {
      await tx.objectStore('plan_marks').delete(m.reportId)
    }
  }

  // 4. sync_queue — wipe целиком: все операции принадлежат текущему юзеру.
  const queue = await tx.objectStore('sync_queue').getAll()
  for (const op of queue) {
    if (op.id != null) {
      await tx.objectStore('sync_queue').delete(op.id)
      stats.syncQueueRemoved++
    }
  }

  // 5. report_mutations — wipe целиком.
  const mutations = await tx.objectStore('report_mutations').getAll()
  for (const m of mutations) {
    if (m.id != null) {
      await tx.objectStore('report_mutations').delete(m.id)
      stats.reportMutationsRemoved++
    }
  }

  // 6. photo_deletes — wipe целиком.
  const photoDeletes = await tx.objectStore('photo_deletes').getAll()
  for (const pd of photoDeletes) {
    await tx.objectStore('photo_deletes').delete(pd.id)
    stats.photoDeletesRemoved++
  }

  // 7. mark_updates — wipe целиком.
  const markUpdates = await tx.objectStore('mark_updates').getAll()
  for (const mu of markUpdates) {
    await tx.objectStore('mark_updates').delete(mu.reportId)
    stats.markUpdatesRemoved++
  }

  // 8. *_local черновики справочников — wipe.
  const wtLocal = await tx.objectStore('work_types_local').getAll()
  for (const it of wtLocal) {
    await tx.objectStore('work_types_local').delete(it.id)
    stats.workTypesLocalRemoved++
  }
  const waLocal = await tx.objectStore('work_assignments_local').getAll()
  for (const it of waLocal) {
    await tx.objectStore('work_assignments_local').delete(it.id)
    stats.workAssignmentsLocalRemoved++
  }

  // 9. sync_issues — wipe.
  const issues = await tx.objectStore('sync_issues').getAll()
  for (const issue of issues) {
    if (issue.id != null) {
      await tx.objectStore('sync_issues').delete(issue.id)
      stats.syncIssuesRemoved++
    }
  }

  await tx.done
  return stats
}

/**
 * Полная очистка пользовательских данных при смене userId на одном
 * устройстве. Дополнительно к wipePendingUserData чистит remote_reports_cache,
 * catalogs, plans_cache — данные одного пользователя не должны утекать в
 * UI другого.
 */
export async function wipeAllUserData(): Promise<void> {
  await wipePendingUserData()
  const db = await getDB()
  const tx = db.transaction(
    ['remote_reports_cache', 'catalogs', 'plans_cache', 'reports', 'photos'],
    'readwrite',
  )
  // Все synced отчёты тоже удаляем — они принадлежали предыдущему юзеру.
  const reports = await tx.objectStore('reports').getAll()
  for (const r of reports) {
    await tx.objectStore('reports').delete(r.id)
  }
  // Remote-origin photos.
  const photos = await tx.objectStore('photos').getAll()
  for (const p of photos) {
    await tx.objectStore('photos').delete(p.id)
  }
  // Cache stores.
  for (const key of await tx.objectStore('remote_reports_cache').getAllKeys()) {
    await tx.objectStore('remote_reports_cache').delete(key)
  }
  for (const key of await tx.objectStore('catalogs').getAllKeys()) {
    await tx.objectStore('catalogs').delete(key)
  }
  for (const key of await tx.objectStore('plans_cache').getAllKeys()) {
    await tx.objectStore('plans_cache').delete(key)
  }
  await tx.done
}
