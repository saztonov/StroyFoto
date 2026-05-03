import { v4 as uuid } from 'uuid'
import {
  getDB,
  type MarkUpdateRecord,
  type PhotoDeleteRecord,
  type ReportMutation,
} from '@/lib/db'
import {
  ConflictError,
  replaceRemotePlanMark,
  updateRemoteReport,
} from '@/services/reports'
import { deleteRemotePhoto } from '@/services/photos'
import { saveDraftPhotosForReport } from '@/services/localReports'
import { triggerSync } from '@/services/sync'
import type { EditReportSaveInput, ExistingPhoto } from '../components/EditReportModal'
import type { LoadedReport } from '../types'

export type SaveReportResult =
  | { kind: 'ok' }
  | { kind: 'conflict'; message: string }
  | { kind: 'queued' }

interface Args {
  id: string
  data: LoadedReport
  values: EditReportSaveInput
  existingPhotos: ExistingPhoto[]
}

/**
 * Полная реализация сохранения отчёта (online + offline ветки).
 * Чистая функция без React-state: возвращает дискриминированный результат,
 * страница сама решает какие сообщения и redirect'ы показать.
 */
export async function saveReport({ id, data, values, existingPhotos }: Args): Promise<SaveReportResult> {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  if (online) {
    try {
      // 1. Обновляем основные поля отчёта (включая planId) с OCC
      await updateRemoteReport(id, {
        workTypeId: values.workTypeId,
        performerId: values.performerId,
        workAssignmentId: values.workAssignmentId,
        description: values.description,
        takenAt: values.takenAt,
        planId: values.planId,
        expectedUpdatedAt: data.card.updatedAt,
      })

      // 2. Удаляем фото (best-effort — ошибки не блокируют)
      for (const p of values.photosToRemove) {
        try {
          await deleteRemotePhoto(p.id, id, p.objectKey, p.thumbObjectKey)
        } catch (e) {
          console.warn('photo delete failed (online):', p.id, e)
        }
      }

      // 3. Новые фото: сохраняем в IDB + ставим в sync queue
      if (values.photosToAdd.length > 0) {
        await saveDraftPhotosForReport(
          id,
          values.photosToAdd.map((p, i) => ({
            id: p.id,
            blob: p.blob,
            thumbBlob: p.thumbBlob,
            width: p.width,
            height: p.height,
            takenAt: p.takenAt,
            order: (existingPhotos.length - values.photosToRemove.length) + i,
          })),
        )
        triggerSync()
      }

      // 4. Метка на плане
      if (values.markChanged) {
        try {
          const markPayload = values.mark && values.mark.xNorm != null && values.mark.yNorm != null
            ? { planId: values.mark.planId, page: values.mark.page, xNorm: values.mark.xNorm, yNorm: values.mark.yNorm }
            : null
          await replaceRemotePlanMark(id, markPayload)
        } catch (e) {
          console.warn('mark update failed (online):', e)
        }
      }

      return { kind: 'ok' }
    } catch (e) {
      if (e instanceof ConflictError) {
        return { kind: 'conflict', message: e.message }
      }
      // Сетевая ошибка — ставим в offline-очередь
      if (!(e instanceof Error) || !/fetch|network|timeout/i.test(e.message)) {
        throw e
      }
    }
  }

  // Offline или сетевая ошибка — ставим всё в очередь.
  // batchId связывает все операции одного сохранения. При CONFLICT на PATCH
  // sync.ts откатит весь батч атомарно — иначе photo_delete и mark_update
  // применились бы к ушедшей вперёд серверной версии.
  const batchId = uuid()
  const db = await getDB()
  const tx = db.transaction(
    ['report_mutations', 'sync_queue', 'photo_deletes', 'mark_updates', 'photos'],
    'readwrite',
  )
  const nowMs = Date.now()

  // 1. Мутация отчёта (report_update)
  const mutation: ReportMutation = {
    kind: 'update',
    reportId: id,
    baseUpdatedAt: data.card.updatedAt ?? data.card.createdAt,
    batchId,
    payload: {
      workTypeId: values.workTypeId,
      performerId: values.performerId,
      workAssignmentId: values.workAssignmentId,
      description: values.description,
      takenAt: values.takenAt,
      planId: values.planId,
    },
    queuedAt: nowMs,
    lastError: null,
    attempts: 0,
    nextAttemptAt: nowMs,
  }
  const mutationId = await tx.objectStore('report_mutations').add(mutation)
  await tx.objectStore('sync_queue').add({
    kind: 'report_update' as const,
    entityId: String(mutationId),
    reportId: id,
    attempts: 0,
    nextAttemptAt: nowMs,
    lastError: null,
  })

  // 2. Удаление фото — все под одним batchId, чтобы при OCC-конфликте
  // откатились вместе с мутацией.
  for (const p of values.photosToRemove) {
    const rec: PhotoDeleteRecord = {
      id: p.id,
      reportId: id,
      objectKey: p.objectKey,
      thumbObjectKey: p.thumbObjectKey,
      batchId,
    }
    await tx.objectStore('photo_deletes').put(rec)
    await tx.objectStore('sync_queue').add({
      kind: 'photo_delete' as const,
      entityId: p.id,
      reportId: id,
      attempts: 0,
      nextAttemptAt: nowMs + 100,
      lastError: null,
    })
  }

  // 3. Новые фото — НЕ привязываем к batchId: добавление фото не зависит
  // от OCC и должно сохраниться даже если PATCH полей упал по конфликту
  // (фото — отдельная сущность, ON CONFLICT в server upsert идемпотентен).
  for (let i = 0; i < values.photosToAdd.length; i++) {
    const p = values.photosToAdd[i]
    await tx.objectStore('photos').put({
      id: p.id,
      reportId: id,
      blob: p.blob,
      thumbBlob: p.thumbBlob,
      width: p.width,
      height: p.height,
      takenAt: p.takenAt,
      order: (existingPhotos.length - values.photosToRemove.length) + i,
      syncStatus: 'pending_upload' as const,
      origin: 'local' as const,
    })
    await tx.objectStore('sync_queue').add({
      kind: 'photo' as const,
      entityId: p.id,
      reportId: id,
      attempts: 0,
      nextAttemptAt: nowMs + 200,
      lastError: null,
    })
  }

  // 4. Метка — также под одним batchId.
  if (values.markChanged) {
    const markRec: MarkUpdateRecord = {
      reportId: id,
      planId: values.mark?.planId ?? null,
      page: values.mark?.page ?? null,
      xNorm: values.mark?.xNorm ?? null,
      yNorm: values.mark?.yNorm ?? null,
      batchId,
    }
    await tx.objectStore('mark_updates').put(markRec)
    await tx.objectStore('sync_queue').add({
      kind: 'mark_update' as const,
      entityId: id,
      reportId: id,
      attempts: 0,
      nextAttemptAt: nowMs + 50,
      lastError: null,
    })
  }

  await tx.done
  triggerSync()
  return { kind: 'queued' }
}
