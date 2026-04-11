import { getDB, type LocalPhoto, type LocalPlanMark, type LocalReport, type SyncOp } from '@/lib/db'

/**
 * Проверяет, осталась ли в `sync_queue` хоть одна задача, связанная с отчётом.
 * Используется aggregation-логикой: отчёт нельзя помечать как `synced`, пока
 * хотя бы одна подзадача (photo/mark/work_type) ещё в очереди или в процессе.
 */
export async function hasPendingOpsForReport(reportId: string): Promise<boolean> {
  const db = await getDB()
  const ops = await db.getAllFromIndex('sync_queue', 'by_report', reportId)
  return ops.length > 0
}

export interface DraftPhotoInput {
  id: string
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  takenAt: string | null
  order: number
}

export interface DraftReportInput {
  id: string
  projectId: string
  workTypeId: string
  performerId: string
  planId: string | null
  description: string | null
  takenAt: string | null
  authorId: string
  photos: DraftPhotoInput[]
  mark: { planId: string; page: number; xNorm: number; yNorm: number } | null
}

/**
 * Атомарно сохраняет отчёт со всеми фото и (опционально) меткой плана,
 * а также ставит операции в очередь синхронизации. Если запись в одно из
 * хранилищ упадёт — транзакция откатится целиком.
 */
export async function saveDraftReport(input: DraftReportInput): Promise<LocalReport> {
  const db = await getDB()
  const now = new Date().toISOString()

  const report: LocalReport = {
    id: input.id,
    projectId: input.projectId,
    workTypeId: input.workTypeId,
    performerId: input.performerId,
    planId: input.planId,
    description: input.description,
    takenAt: input.takenAt,
    authorId: input.authorId,
    createdAt: now,
    syncStatus: 'pending',
    lastError: null,
  }

  const tx = db.transaction(
    ['reports', 'photos', 'plan_marks', 'sync_queue'],
    'readwrite',
  )

  await tx.objectStore('reports').put(report)

  const photosStore = tx.objectStore('photos')
  for (const p of input.photos) {
    const photo: LocalPhoto = {
      id: p.id,
      reportId: input.id,
      blob: p.blob,
      thumbBlob: p.thumbBlob,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
      order: p.order,
      syncStatus: 'pending_upload',
      origin: 'local',
    }
    await photosStore.put(photo)
  }

  if (input.mark) {
    const mark: LocalPlanMark = {
      reportId: input.id,
      planId: input.mark.planId,
      page: input.mark.page,
      xNorm: input.mark.xNorm,
      yNorm: input.mark.yNorm,
      syncStatus: 'pending',
    }
    await tx.objectStore('plan_marks').put(mark)
  }

  const queue = tx.objectStore('sync_queue')
  // Снимок существующих операций в очереди, чтобы не плодить дубликаты
  // при повторном вызове saveDraftReport с тем же id (напр. retry после
  // частичной ошибки или двойной сабмит формы в React StrictMode).
  const existing = await queue.getAll()
  const hasOp = (kind: SyncOp['kind'], entityId: string) =>
    existing.some((o) => o.kind === kind && o.entityId === entityId)

  const nowMs = Date.now()
  if (!hasOp('report', input.id)) {
    const reportOp: SyncOp = {
      kind: 'report',
      entityId: input.id,
      reportId: input.id,
      attempts: 0,
      nextAttemptAt: nowMs,
      lastError: null,
    }
    await queue.add(reportOp)
  }
  if (input.mark && !hasOp('mark', input.id)) {
    const markOp: SyncOp = {
      kind: 'mark',
      entityId: input.id,
      reportId: input.id,
      attempts: 0,
      nextAttemptAt: nowMs + 100,
      lastError: null,
    }
    await queue.add(markOp)
  }

  // Photo ops ставим после report/mark — они выгрузятся, когда presign будет готов.
  // Идемпотентность обеспечивается стабильным photo.id (UUID, client-generated).
  for (const p of input.photos) {
    if (hasOp('photo', p.id)) continue
    const photoOp: SyncOp = {
      kind: 'photo',
      entityId: p.id,
      reportId: input.id,
      attempts: 0,
      nextAttemptAt: nowMs + 200,
      lastError: null,
    }
    await queue.add(photoOp)
  }

  await tx.done
  return report
}

export async function listLocalReports(): Promise<LocalReport[]> {
  const db = await getDB()
  const all = await db.getAll('reports')
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function getLocalReport(id: string) {
  const db = await getDB()
  return db.get('reports', id)
}

export async function getPhotosForReport(reportId: string): Promise<LocalPhoto[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('photos', 'by_report', reportId)
  return all.sort((a, b) => a.order - b.order)
}

export async function updateReportStatus(
  id: string,
  syncStatus: LocalReport['syncStatus'],
  lastError: string | null = null,
) {
  const db = await getDB()
  const r = await db.get('reports', id)
  if (!r) return
  r.syncStatus = syncStatus
  r.lastError = lastError
  await db.put('reports', r)
}

export async function countPendingReports(): Promise<number> {
  const db = await getDB()
  // Агрегированный счётчик: отчёт считается "в работе", если:
  //  - у него статус pending/failed, ИЛИ
  //  - для него есть хотя бы одна живая задача в sync_queue (photo/mark/work_type)
  // Это важно, потому что сам отчёт может уже быть помечен synced на сервере,
  // но фотографии всё ещё заливаются — и UI должен это показать.
  const [reports, queue] = await Promise.all([db.getAll('reports'), db.getAll('sync_queue')])
  const stuck = new Set<string>()
  for (const op of queue) {
    const rid = op.reportId ?? (op.kind === 'report' || op.kind === 'mark' ? op.entityId : undefined)
    if (rid) stuck.add(rid)
  }
  for (const r of reports) {
    if (r.syncStatus === 'pending' || r.syncStatus === 'failed') stuck.add(r.id)
  }
  return stuck.size
}

/**
 * Безопасно помечает отчёт как synced, только если в sync_queue больше нет
 * задач, связанных с ним. Иначе оставляет статус pending с последней ошибкой.
 * Вызывается из sync loop после успешной обработки каждой операции.
 */
export async function markReportSyncedIfComplete(reportId: string): Promise<void> {
  const db = await getDB()
  const remaining = await db.getAllFromIndex('sync_queue', 'by_report', reportId)
  if (remaining.length > 0) return
  const report = await db.get('reports', reportId)
  if (!report) return
  if (report.syncStatus === 'synced') return
  report.syncStatus = 'synced'
  report.lastError = null
  await db.put('reports', report)
}
