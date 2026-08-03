import { ApiError, apiFetch } from '@/lib/apiClient'
import { restoreSession } from '@/services/auth'
import { getDB, type CatalogKind, type ReportMutation, type SyncOp } from '@/lib/db'
import {
  applyServerTimestamps,
  countPendingReports,
  markReportSyncedIfComplete,
  updateReportStatus,
} from '@/services/localReports'
import { deleteRemotePhoto, markPhotoSynced, uploadPhoto } from '@/services/photos'
import { replaceRemotePhotoPlanMarks, replaceRemotePlanMark } from '@/services/reports'
import { applyRetention } from '@/services/retention'
import { warnIfQuotaHigh } from '@/services/storageQuota'
import { emitReportsChanged } from '@/services/invalidation'
import { reconcile } from '@/services/reconcile'
import { closeCatalogIssues, recordSyncIssue } from '@/services/syncIssues'
import { discardOfflineBatch } from '@/services/syncBatch'
import { bumpReportSyncOps, remapCatalogId } from '@/services/catalogRemap'

// ---------------------------------------------------------------------------
// Классификация ошибок: transient → retry, auth → refresh + retry,
// permanent → fail immediately (без retry-storm).
// ---------------------------------------------------------------------------

type ErrorClass = 'transient' | 'auth' | 'permanent' | 'blocked'

// Коды справочника, при которых данные НЕ теряются: позиция появится, когда
// админ её заведёт или вернёт из архива. Проверяются раньше статусов, потому
// что 403/409 сами по себе означают permanent (см. classifyError).
const BLOCKED_CODES = new Set(['DICT_CREATE_FORBIDDEN', 'DICT_INACTIVE'])

interface ClassifiableError {
  code?: string
  message?: string
  status?: number
  details?: unknown
}

function classifyError(err: ClassifiableError): ErrorClass {
  const status = err.status ?? 0
  // ВАЖНО: проверка кодов справочника обязана стоять ПЕРВОЙ. DICT_CREATE_FORBIDDEN
  // приходит с 403, DICT_INACTIVE — с 409, и обе статусные ветки ниже увели бы
  // их в permanent, где операция удаляется молча вместе с зависимым отчётом.
  if (err.code && BLOCKED_CODES.has(err.code)) return 'blocked'
  if (status === 401) return 'auth'
  if (status === 403) return 'permanent'
  if (status === 400 || status === 422 || status === 409) return 'permanent'
  // CONFLICT/FK/CHECK по коду от backend → permanent.
  // PHOTO_REPORT_MISMATCH — то же permanent: фото уже привязано к чужому отчёту.
  // TIMEOUT — transient (apiClient бросает ApiError(0, 'TIMEOUT')).
  const code = err.code ?? ''
  if (code === 'CONFLICT' || code === 'FK_VIOLATION' || code === 'CHECK_VIOLATION' ||
      code === 'PHOTO_REPORT_MISMATCH') {
    return 'permanent'
  }
  // Network/5xx/TIMEOUT → transient
  return 'transient'
}

function toClassifiable(e: unknown): ClassifiableError {
  if (e instanceof ApiError) {
    return { code: e.code, message: e.message, status: e.status, details: e.details }
  }
  if (e instanceof Error) {
    return { message: e.message }
  }
  return { message: String(e) }
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

/** reportId операции: у report/mark он лежит в entityId, у остальных — отдельно. */
function opReportId(op: SyncOp): string | null {
  return op.reportId ?? (op.kind === 'report' || op.kind === 'mark' ? op.entityId : null)
}

/**
 * Операции, без которых метку отправлять нельзя.
 *
 * Точка ссылается на report_photos.id, поэтому пока фотография не загружена,
 * сервер о ней не знает. Одного лишь порядка сортировки недостаточно: при
 * transient-ошибке фото операция откладывается, а цикл переходит к следующей —
 * и метка ушла бы вперёд, получив отказ. `report_update` в списке обязателен,
 * иначе OCC-батч применился бы наполовину.
 */
const MARK_PREREQUISITES = new Set([
  'report',
  'report_update',
  'report_delete',
  'photo',
  'photo_delete',
])

function isBlockedByPrerequisites(op: SyncOp, all: SyncOp[]): boolean {
  if (op.kind !== 'mark' && op.kind !== 'mark_update') return false
  const rid = opReportId(op)
  if (!rid) return false
  // Именно пропускаем, а не блокируем: handleBlockedCatalog ставит шесть часов
  // и заводит sync-issue — для обычной очерёдности это чрезмерно.
  return all.some((o) => o !== op && MARK_PREREQUISITES.has(o.kind) && opReportId(o) === rid)
}

interface ProcessResult {
  done: boolean
  error?: string
  errorCode?: string
  errorStatus?: number
  // Машиночитаемый контекст от сервера. Для DICT_* содержит
  // { catalogKind, catalogId } — какая позиция справочника заблокировала отчёт.
  errorDetails?: unknown
}

/**
 * При OCC-конфликте откатываем весь батч офлайн-правок одним пакетом
 * (politika «server wins»). Это значит что mutation + связанные
 * photo_deletes + mark_update под одним batchId удаляются вместе, а
 * пользователь получает sync_issue «Изменения отменены».
 *
 * Для legacy-записей без batchId удаляется только сама мутация — старое
 * поведение, чтобы не сломать миграцию.
 *
 * После rollback запускаем reconcile, чтобы UI получил актуальную
 * серверную версию отчёта.
 */
async function handleConflict(
  mutation: ReportMutation,
  serverMessage: string | null,
): Promise<void> {
  const db = await getDB()
  if (mutation.batchId) {
    try {
      await discardOfflineBatch(mutation.batchId)
    } catch (e) {
      console.warn('discardOfflineBatch failed for batch', mutation.batchId, e)
    }
  } else {
    // legacy путь — просто удаляем эту мутацию
    if (mutation.id != null) {
      try { await db.delete('report_mutations', mutation.id) } catch { /* ignore */ }
    }
  }
  await recordSyncIssue({
    reportId: mutation.reportId,
    kind: 'conflict',
    message: serverMessage ?? 'Изменения отменены: версия отчёта на сервере новее. Внесите правки заново.',
    batchId: mutation.batchId ?? null,
  })
  // Подтянем актуальную серверную версию, чтобы UI её сразу увидел.
  void reconcile().catch(() => undefined)
}

/**
 * Успешная синхронизация справочника снимает блокировку с зависевших отчётов:
 * возвращаем их из `blocked` в `pending` и закрываем issue. Без этого отчёт
 * остался бы с оранжевым статусом, а SyncBanner продолжал бы показывать уже
 * решённую проблему до перезагрузки приложения.
 */
async function unblockAfterCatalogSync(kind: CatalogKind, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDB()
  const field = kind === 'work_type' ? 'workTypeId' : 'workAssignmentId'
  const idSet = new Set(ids)

  const tx = db.transaction('reports', 'readwrite')
  for (const r of await tx.store.getAll()) {
    if (r.syncStatus !== 'blocked') continue
    const value = r[field]
    if (!value || !idSet.has(value)) continue
    r.syncStatus = 'pending'
    r.lastError = null
    await tx.store.put(r)
  }
  await tx.done

  for (const id of idSet) await closeCatalogIssues(kind, id)
}

async function processOp(op: SyncOp): Promise<ProcessResult> {
  const db = await getDB()

  if (op.kind === 'photo') {
    const photo = await db.get('photos', op.entityId)
    if (!photo) return { done: true }
    if (photo.origin === 'remote') return { done: true }
    if (photo.syncStatus === 'synced') return { done: true }
    try {
      const { objectKey, thumbObjectKey } = await uploadPhoto(photo)
      await markPhotoSynced(photo.id, objectKey, thumbObjectKey)
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
      performer_ids: report.performerIds ?? [report.performerId],
      work_assignment_id: report.workAssignmentId,
      plan_id: report.planId,
      description: report.description,
      taken_at: report.takenAt,
    }
    try {
      // Принимаем полный объект с серверными created_at/updated_at —
      // последующие PATCH должны идти с правильным OCC-токеном (точное
      // строковое значение updated_at из Postgres, без потерь миллисекунд
      // на JS Date round-trip). Без этого свежесозданный отчёт сразу при
      // первой правке ловит ложный CONFLICT.
      const resp = await apiFetch<{ report?: { created_at?: string; updated_at?: string } }>(
        '/api/reports',
        { method: 'POST', body: payload },
      )
      const r = resp?.report
      if (r?.created_at && r?.updated_at) {
        await applyServerTimestamps(report.id, r.created_at, r.updated_at)
      }
      return { done: true }
    } catch (e) {
      const c = toClassifiable(e)
      return { done: false, error: c.message, errorCode: c.code, errorStatus: c.status, errorDetails: c.details }
    }
  }

  if (op.kind === 'mark') {
    const mark = await db.get('plan_marks', op.entityId)
    if (!mark) return { done: true }
    try {
      // Легаси-метка отправляется старым роутом. Отсутствие `marks` означает
      // «запись сделана клиентом, не знавшим о точках фотографий» — разворачивать
      // её в replace-all нельзя, это удалило бы чужие точки.
      if (mark.planId != null && mark.page != null && mark.xNorm != null && mark.yNorm != null) {
        await apiFetch(`/api/reports/${mark.reportId}/plan-mark`, {
          method: 'PUT',
          body: {
            plan_id: mark.planId,
            page: mark.page,
            x_norm: mark.xNorm,
            y_norm: mark.yNorm,
          },
        })
      }
      if (mark.marks !== undefined) {
        // Первая отправка с устройства: версию не проверяем, набор задаём.
        await replaceRemotePhotoPlanMarks(mark.reportId, mark.marks, null)
      }
      return { done: true }
    } catch (e) {
      const c = toClassifiable(e)
      return { done: false, error: c.message, errorCode: c.code, errorStatus: c.status, errorDetails: c.details }
    }
  }

  if (op.kind === 'report_update') {
    const mutation = await db.get('report_mutations', Number(op.entityId))
    if (!mutation) return { done: true }
    if (!mutation.payload) return { done: true }
    const updatePayload: Record<string, unknown> = {
      work_type_id: mutation.payload.workTypeId,
      performer_id: mutation.payload.performerId,
      // Мутации, накопленные до этого релиза, поля не содержат. Отправлять
      // фолбэк [performerId] здесь НЕЛЬЗЯ: сервер воспримет это как явную
      // замену набора и потеряет остальных подрядчиков отчёта.
      ...(mutation.payload.performerIds
        ? { performer_ids: mutation.payload.performerIds }
        : {}),
      work_assignment_id: mutation.payload.workAssignmentId,
      description: mutation.payload.description,
      taken_at: mutation.payload.takenAt,
      // baseUpdatedAt — точная серверная строка timestamptz (см. #4),
      // сервер примет как text и кастит в timestamptz сам.
      expectedUpdatedAt: mutation.baseUpdatedAt,
    }
    if (mutation.payload.planId !== undefined) {
      updatePayload.plan_id = mutation.payload.planId
    }
    try {
      await apiFetch(`/api/reports/${mutation.reportId}`, {
        method: 'PATCH',
        body: updatePayload,
      })
      await db.delete('report_mutations', mutation.id!)
      return { done: true }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        // OCC-конфликт — server wins. Откатываем весь пакет (mutation +
        // photo_deletes + mark_update под одним batchId), чтобы не применять
        // куски устаревшего пакета к ушедшей вперёд серверной версии.
        // Создаём sync_issue, чтобы пользователь увидел причину.
        await handleConflict(mutation, e.message)
        return { done: true }
      }
      const c = toClassifiable(e)
      return { done: false, error: c.message, errorCode: c.code, errorStatus: c.status, errorDetails: c.details }
    }
  }

  if (op.kind === 'report_delete') {
    const mutation = await db.get('report_mutations', Number(op.entityId))
    if (!mutation) return { done: true }
    try {
      await apiFetch(`/api/reports/${mutation.reportId}`, { method: 'DELETE' })
      await db.delete('report_mutations', mutation.id!)
      return { done: true }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        await db.delete('report_mutations', mutation.id!)
        return { done: true }
      }
      const c = toClassifiable(e)
      return { done: false, error: c.message, errorCode: c.code, errorStatus: c.status, errorDetails: c.details }
    }
  }

  if (op.kind === 'photo_delete') {
    const rec = await db.get('photo_deletes', op.entityId)
    if (!rec) return { done: true }
    try {
      await deleteRemotePhoto(rec.id, rec.reportId, rec.objectKey, rec.thumbObjectKey)
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

      // Набор точек отправляем ТОЛЬКО когда запись его содержит. Мутации,
      // накопленные до релиза, поля не имеют: развернуть их фолбэком в
      // [legacyMark] и отправить replace-all означало бы удалить точки
      // фотографий, созданные другими клиентами.
      if (rec.marks !== undefined) {
        await replaceRemotePhotoPlanMarks(
          rec.reportId,
          rec.marks,
          rec.expectedMarksVersion ?? null,
        )
      }

      await db.delete('mark_updates', rec.reportId)
      // Обновляем локальный plan_marks store
      if (mark || rec.marks?.length) {
        await db.put('plan_marks', {
          reportId: rec.reportId,
          ...(mark
            ? { planId: mark.planId, page: mark.page, xNorm: mark.xNorm, yNorm: mark.yNorm }
            : {}),
          ...(rec.marks !== undefined ? { marks: rec.marks } : {}),
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
    // Локальный work_type, созданный офлайн. POST /api/work-types — backend
    // делает idempotent upsert: дубликат по id или по name (citext unique)
    // возвращает существующую запись.
    //
    // КРИТИЧНО: если другой пользователь уже создал work_type с тем же
    // названием на сервере, backend вернёт его существующий UUID (не наш
    // local UUID). Без ремапа отчёт A потом упал бы с FK_VIOLATION.
    const local = await db.get('work_types_local', op.entityId)
    if (!local) return { done: true }
    try {
      const resp = await apiFetch<{ workType?: { id: string } }>('/api/work-types', {
        method: 'POST',
        body: { id: local.id, name: local.name },
      })
      const serverId = resp?.workType?.id
      if (serverId && serverId !== local.id) {
        const result = await remapCatalogId({
          kind: 'work_type',
          oldId: local.id,
          newId: serverId,
        })
        // Зависевшие от этого справочника отчёты должны уйти в этом же тике
        // с правильным id, иначе они застрянут в backoff с FK_VIOLATION.
        await bumpReportSyncOps(result.remappedReports)
      } else {
        local.syncStatus = 'synced'
        await db.put('work_types_local', local)
      }
      // Справочник принят — снимаем блокировку, если она была. Оба id: до
      // ремапа отчёты ссылались на local.id, после — на серверный.
      await unblockAfterCatalogSync('work_type', [local.id, serverId].filter(Boolean) as string[])
      return { done: true }
    } catch (e) {
      const c = toClassifiable(e)
      return { done: false, error: c.message, errorCode: c.code, errorStatus: c.status, errorDetails: c.details }
    }
  }

  if (op.kind === 'work_assignment') {
    const local = await db.get('work_assignments_local', op.entityId)
    if (!local) return { done: true }
    try {
      const resp = await apiFetch<{ workAssignment?: { id: string } }>('/api/work-assignments', {
        method: 'POST',
        body: { id: local.id, name: local.name },
      })
      const serverId = resp?.workAssignment?.id
      if (serverId && serverId !== local.id) {
        const result = await remapCatalogId({
          kind: 'work_assignment',
          oldId: local.id,
          newId: serverId,
        })
        await bumpReportSyncOps(result.remappedReports)
      } else {
        local.syncStatus = 'synced'
        await db.put('work_assignments_local', local)
      }
      await unblockAfterCatalogSync(
        'work_assignment',
        [local.id, serverId].filter(Boolean) as string[],
      )
      return { done: true }
    } catch (e) {
      const c = toClassifiable(e)
      return { done: false, error: c.message, errorCode: c.code, errorStatus: c.status, errorDetails: c.details }
    }
  }

  return { done: true }
}

// Circuit breaker: если подряд CONSECUTIVE_TRANSIENT_LIMIT транзиент-ошибок —
// сворачиваем tick. Раньше break случался на ПЕРВОЙ transient ошибке, и при
// флапающей сети 99 операций в очереди ждали следующего тика (30с). Теперь
// одна неудача не блокирует остальную очередь, но и мёртвую сеть не молотим.
const CONSECUTIVE_TRANSIENT_LIMIT = 3

async function tick() {
  if (running) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setSnapshot({ state: 'offline' })
    return
  }
  running = true
  let pushedAny = false
  let consecutiveTransient = 0
  setSnapshot({ state: 'syncing' })
  try {
    const db = await getDB()
    while (true) {
      const all = await db.getAll('sync_queue')
      const now = Date.now()
      const next = all
        .filter((o) => o.nextAttemptAt <= now)
        .filter((o) => !isBlockedByPrerequisites(o, all))
        .sort((a, b) => {
          // work_type/work_assignment → report → photo → mark. Справочники
          // идут первыми, потому что отчёт может ссылаться на их локальные id.
          // Метки — последними: точка ссылается на report_photos.id, и до
          // загрузки самой фотографии строки на сервере ещё нет.
          const order: Record<string, number> = { work_type: 0, work_assignment: 0, report: 1, report_update: 1, report_delete: 1, photo: 2, photo_delete: 3, mark: 4, mark_update: 4 }
          return order[a.kind] - order[b.kind] || a.nextAttemptAt - b.nextAttemptAt
        })[0]
      if (!next) break

      const result = await processOp(next)
      if (result.done) {
        pushedAny = true
        consecutiveTransient = 0 // успех сбрасывает circuit breaker
        if (next.id != null) await db.delete('sync_queue', next.id)
        // После успеха проверяем, можно ли агрегированно пометить отчёт synced.
        // markReportSyncedIfComplete атомарен (см. localReports.ts) — race
        // с параллельным add() в sync_queue безопасен.
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
          consecutiveTransient = 0
          // Токен протух — пробуем обновить и повторить немедленно
          const restored = await restoreSession()
          if (!restored) {
            setSnapshot({ state: 'error', lastError: 'Сессия истекла. Войдите заново.' })
            break
          }
          next.nextAttemptAt = Date.now()
          if (next.id != null) await db.put('sync_queue', next)
          continue
        }

        if (errClass === 'blocked') {
          consecutiveTransient = 0
          // Справочник не пропустил позицию. Данные целы — ничего не удаляем,
          // откладываем операцию и всё, что от неё зависит.
          await handleBlockedCatalog(next, result)
          continue
        }

        if (errClass === 'permanent') {
          consecutiveTransient = 0
          // Permanent-ошибка: не ретраим. Если эта операция была частью
          // батча правок (есть batchId) — откатываем весь батч и заводим
          // sync_issue. Иначе старое поведение: просто помечаем отчёт failed.
          await handlePermanentFailure(next, result)
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
        consecutiveTransient += 1
        if (consecutiveTransient >= CONSECUTIVE_TRANSIENT_LIMIT) {
          // Сеть, видимо, действительно мёртвая — экономим батарею до
          // следующего тика, но обработали уже несколько других операций
          // (если первая упала, мы продолжали), а не одну единственную.
          break
        }
        // Не break — продолжаем обрабатывать остальные операции (другие фото,
        // другие отчёты могут пройти даже если эта зависла).
        continue
      }
    }
    setSnapshot({ state: 'idle' })
    // Уведомляем UI и другие вкладки только если в этом тике реально что-то
    // было успешно отправлено. Иначе пустые тики раз в 30с зря дёргали список.
    if (pushedAny) {
      emitReportsChanged()
    }
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

/**
 * Permanent-ошибка от сервера: запись sync_issue, удаление операции из
 * очереди, помечание отчёта как failed. Если операция связана с batch'ем
 * правок (например, photo_delete с batchId) — откатываем весь батч.
 */
/**
 * Отложенный ретрай заблокированной справочником операции. 6 часов —
 * компромисс: достаточно редко, чтобы не молотить сервер отказами, и
 * достаточно часто, чтобы отчёт ушёл в тот же рабочий день после действий
 * админа. Ручные пути (кнопка «Повторить», замена позиции) этот срок не ждут.
 */
const BLOCKED_RETRY_MS = 6 * 60 * 60 * 1000

function parseCatalogDetails(
  details: unknown,
): { catalogKind: CatalogKind; catalogId: string } | null {
  if (typeof details !== 'object' || details === null) return null
  const d = details as { catalogKind?: unknown; catalogId?: unknown }
  if (d.catalogKind !== 'work_type' && d.catalogKind !== 'work_assignment') return null
  if (typeof d.catalogId !== 'string' || !d.catalogId) return null
  return { catalogKind: d.catalogKind, catalogId: d.catalogId }
}

/**
 * Справочник не пропустил позицию (создавать может только админ, либо позиция
 * в архиве). В отличие от permanent — НИЧЕГО не удаляем: и локальный черновик
 * справочника, и очередь целы, данные восстановимы.
 *
 * Откладываем саму операцию и ВСЕ зависимые (report, report_update, mark,
 * mark_update, photo, photo_delete, report_delete). Откладывать только фото и
 * метки нельзя: сам отчёт был бы выбран в этом же тике и упал бы с
 * FK_VIOLATION, то есть уже по ветке permanent — с потерей данных.
 *
 * Сдвиг nextAttemptAt здесь же служит защитой от бесконечного цикла: ветка
 * blocked, как и permanent, делает `continue` без удаления операции, и без
 * сдвига времени очередь выбрала бы её снова немедленно.
 */
async function handleBlockedCatalog(op: SyncOp, result: ProcessResult): Promise<void> {
  const db = await getDB()
  const until = Date.now() + BLOCKED_RETRY_MS
  const message = result.error ?? 'Позиция справочника недоступна'

  // Какая позиция виновата: для catalog-операции это она сама, для report-ветки
  // сервер присылает пару в details (см. AppError в reportsService).
  const fromDetails = parseCatalogDetails(result.errorDetails)
  const blocking: { catalogKind: CatalogKind; catalogId: string } | null =
    op.kind === 'work_type' || op.kind === 'work_assignment'
      ? { catalogKind: op.kind, catalogId: op.entityId }
      : fromDetails

  const affected = new Set<string>()
  const tx = db.transaction(['reports', 'sync_queue'], 'readwrite')
  const reportsStore = tx.objectStore('reports')
  const queueStore = tx.objectStore('sync_queue')

  if (blocking) {
    const field = blocking.catalogKind === 'work_type' ? 'workTypeId' : 'workAssignmentId'
    for (const r of await reportsStore.getAll()) {
      if (r[field] !== blocking.catalogId) continue
      affected.add(r.id)
      if (r.syncStatus !== 'blocked') {
        r.syncStatus = 'blocked'
        r.lastError = message
        await reportsStore.put(r)
      }
    }
  }
  // Отчёт мог упереться в справочник и напрямую (POST /api/reports → DICT_INACTIVE).
  const ownRid = op.reportId ?? (op.kind === 'report' || op.kind === 'mark' ? op.entityId : null)
  if (ownRid) {
    const own = await reportsStore.get(ownRid)
    if (own) {
      affected.add(own.id)
      if (own.syncStatus !== 'blocked') {
        own.syncStatus = 'blocked'
        own.lastError = message
        await reportsStore.put(own)
      }
    }
  }

  for (const o of await queueStore.getAll()) {
    if (o.id == null) continue
    const isSelf = o.id === op.id
    // Сопоставление операции с отчётом — тем же способом, что в bumpReportSyncOps:
    // у части видов reportId лежит в entityId.
    const rid = o.reportId ?? (o.kind === 'report' || o.kind === 'mark' ? o.entityId : null)
    if (!isSelf && !(rid && affected.has(rid))) continue
    o.nextAttemptAt = until
    o.lastError = message
    await queueStore.put(o)
  }
  await tx.done

  for (const reportId of affected) {
    await recordSyncIssue({
      reportId,
      kind: 'dict_blocked',
      message,
      catalogKind: blocking?.catalogKind ?? null,
      catalogId: blocking?.catalogId ?? null,
    })
  }
  setSnapshot({ lastError: message })
}

async function handlePermanentFailure(op: SyncOp, result: ProcessResult): Promise<void> {
  const db = await getDB()
  const rid = op.reportId ?? (op.kind === 'report' || op.kind === 'mark' ? op.entityId : null)

  // Если у operation есть batchId — пытаемся найти его и откатить весь пакет.
  let batchId: string | null = null
  if (op.kind === 'report_update' || op.kind === 'report_delete') {
    const mutation = await db.get('report_mutations', Number(op.entityId))
    batchId = mutation?.batchId ?? null
  } else if (op.kind === 'photo_delete') {
    const pd = await db.get('photo_deletes', op.entityId)
    batchId = pd?.batchId ?? null
  } else if (op.kind === 'mark_update') {
    const mu = await db.get('mark_updates', op.entityId)
    batchId = mu?.batchId ?? null
  }

  if (batchId) {
    try { await discardOfflineBatch(batchId) } catch (e) {
      console.warn('discardOfflineBatch on permanent failed', batchId, e)
    }
  } else if (op.id != null) {
    try { await db.delete('sync_queue', op.id) } catch { /* ignore */ }
  }

  if (rid) {
    const issueKind = result.errorCode === 'PHOTO_REPORT_MISMATCH'
      ? 'photo_mismatch'
      : result.errorCode === 'FK_VIOLATION'
        ? 'fk_violation'
        : 'permanent'
    await recordSyncIssue({
      reportId: rid,
      kind: issueKind,
      message: result.error ?? 'Постоянная ошибка синхронизации',
      batchId,
    })
    await updateReportStatus(rid, 'failed', result.error ?? 'Постоянная ошибка')
  }
  setSnapshot({ lastError: result.error ?? null })
}

/**
 * Ручное восстановление заблокированного отчёта: пользователь выбирает вместо
 * непринятой позиции существующую активную.
 *
 * Обычным редактированием это не решается: онлайн-ветка saveReport безусловно
 * делает PATCH /api/reports/:id, а заблокированный отчёт на сервере ещё не
 * существует — получили бы 404, и локальные ссылки остались бы неисправленными.
 * Поэтому правим локальные данные напрямую и заново будим очередь.
 *
 * Возвращает количество отчётов, которые были переведены на новую позицию.
 */
export async function replaceBlockedCatalog(input: {
  kind: CatalogKind
  oldId: string
  newId: string
}): Promise<number> {
  const db = await getDB()

  // remapCatalogId одной транзакцией переписывает reports, report_mutations,
  // кэш справочников и удаляет *_local-черновик.
  const result = await remapCatalogId({
    kind: input.kind,
    oldId: input.oldId,
    newId: input.newId,
  })

  // Операция справочника больше не нужна: её черновик удалён вместе с remap.
  for (const op of await db.getAll('sync_queue')) {
    if (op.id == null) continue
    if (op.kind !== input.kind) continue
    if (op.entityId !== input.oldId) continue
    try { await db.delete('sync_queue', op.id) } catch { /* ignore */ }
  }

  await unblockAfterCatalogSync(input.kind, [input.oldId, input.newId])
  // Зависимые операции лежат с отложенным nextAttemptAt — возвращаем их в строй.
  await bumpReportSyncOps(result.remappedReports)
  await refreshPending()
  triggerSync()
  return result.remappedReports.length
}

export function triggerSync() {
  void tick()
}

/** Запускает один цикл синхронизации и ждёт его завершения. */
export async function runSyncOnce(): Promise<void> {
  await tick()
}

/**
 * Per-report retry: переставляет nextAttemptAt = now() и сбрасывает attempts
 * для всех sync_queue items, привязанных к указанному отчёту. Используется
 * кнопкой «Повторить» на карточке отчёта.
 *
 * Возвращает true если найдены и переставлены ops; false если очередь
 * для этого отчёта пуста (отчёт уже синхронизирован или его нет).
 */
export async function retryReport(reportId: string): Promise<boolean> {
  const db = await getDB()
  const tx = db.transaction(['sync_queue', 'reports'], 'readwrite')
  const queueStore = tx.objectStore('sync_queue')
  const reportsStore = tx.objectStore('reports')
  const report = await reportsStore.get(reportId)

  const ops = await queueStore.index('by_report').getAll(reportId)

  // Индекс by_report не находит операции справочников — у них нет reportId
  // (см. createOrQueueWorkType). Если отчёт заблокирован справочником, без
  // этого блока кнопка «Повторить» переставила бы зависимые операции, но не
  // ту единственную, которая их держит, и ничего бы не изменилось.
  const catalogIds = new Set(
    [report?.workTypeId, report?.workAssignmentId].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    ),
  )
  for (const op of await queueStore.getAll()) {
    if (op.kind !== 'work_type' && op.kind !== 'work_assignment') continue
    if (!catalogIds.has(op.entityId)) continue
    if (ops.some((o) => o.id != null && o.id === op.id)) continue
    ops.push(op)
  }

  if (ops.length === 0) {
    await tx.done
    return false
  }
  const nowMs = Date.now()
  for (const op of ops) {
    if (op.id == null) continue
    op.attempts = 0
    op.lastError = null
    op.nextAttemptAt = nowMs
    await queueStore.put(op)
  }
  // Сбрасываем failed/blocked → pending у самого отчёта, чтобы UI обновился
  // правильно сразу до завершения retry.
  if (report && (report.syncStatus === 'failed' || report.syncStatus === 'blocked')) {
    report.syncStatus = 'pending'
    report.lastError = null
    await reportsStore.put(report)
  }
  await tx.done
  triggerSync()
  return true
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
