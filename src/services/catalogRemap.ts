/**
 * Ремап локальных id справочников после синхронизации.
 *
 * Сценарий: офлайн пользователь A создал work_type "Стяжка пола" с client UUID
 * `local-uuid-1` и привязал к нему черновик отчёта. Пользователь B уже создал
 * на сервере work_type с тем же именем (citext-уникальный) под id `server-uuid-2`.
 * Когда A выходит онлайн, sync POST /api/work-types вернёт **server-uuid-2**
 * (idempotent upsert по name). Если оставить отчёт A с work_type_id =
 * `local-uuid-1`, POST /api/reports упадёт с FK_VIOLATION.
 *
 * Поэтому при несовпадении id сразу ремапим во всех IDB-зависимостях:
 * reports, report_mutations, catalogs cache, work_types_local. После ремапа
 * все ожидающие отчёты получают `nextAttemptAt = now()` — sync продолжит
 * текущий tick с правильным id.
 */

import {
  getDB,
  type CatalogKey,
  type LocalReport,
  type ReportMutation,
} from '@/lib/db'

export interface CatalogRemap {
  kind: 'work_type' | 'work_assignment'
  oldId: string
  newId: string
}

interface CachedNamedDict {
  id: string
  name: string
  is_active?: boolean
  created_by?: string | null
  created_at?: string
  [k: string]: unknown
}

const CATALOG_KEY: Record<CatalogRemap['kind'], CatalogKey> = {
  work_type: 'work_types',
  work_assignment: 'work_assignments',
}

const LOCAL_STORE: Record<CatalogRemap['kind'], 'work_types_local' | 'work_assignments_local'> = {
  work_type: 'work_types_local',
  work_assignment: 'work_assignments_local',
}

function reportFieldFor(kind: CatalogRemap['kind']): keyof LocalReport {
  return kind === 'work_type' ? 'workTypeId' : 'workAssignmentId'
}

function mutationFieldFor(
  kind: CatalogRemap['kind'],
): keyof NonNullable<ReportMutation['payload']> {
  return kind === 'work_type' ? 'workTypeId' : 'workAssignmentId'
}

export interface RemapResult {
  remappedReports: string[]   // reportId, который теперь использует newId
  remappedMutations: number   // сколько ReportMutation поправлено
  removedLocalDraft: boolean  // удалили ли запись из *_local
  catalogPatched: boolean
}

/**
 * Производит ремап oldId → newId в одной IDB-транзакции.
 * Возвращает список затронутых reportId — caller должен переставить
 * `nextAttemptAt = now()` для соответствующих sync_queue ops, чтобы
 * report ушёл на сервер уже с правильным справочником.
 */
export async function remapCatalogId(remap: CatalogRemap): Promise<RemapResult> {
  if (remap.oldId === remap.newId) {
    return {
      remappedReports: [],
      remappedMutations: 0,
      removedLocalDraft: false,
      catalogPatched: false,
    }
  }

  const db = await getDB()
  const tx = db.transaction(
    ['reports', 'report_mutations', 'catalogs', LOCAL_STORE[remap.kind]],
    'readwrite',
  )

  const result: RemapResult = {
    remappedReports: [],
    remappedMutations: 0,
    removedLocalDraft: false,
    catalogPatched: false,
  }

  // 1. Reports
  const reportField = reportFieldFor(remap.kind)
  const reports = await tx.objectStore('reports').getAll()
  for (const r of reports) {
    if (r[reportField] === remap.oldId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(r as any)[reportField] = remap.newId
      await tx.objectStore('reports').put(r)
      result.remappedReports.push(r.id)
    }
  }

  // 2. Report mutations payload
  const mutField = mutationFieldFor(remap.kind)
  const mutations = await tx.objectStore('report_mutations').getAll()
  for (const m of mutations) {
    if (!m.payload) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((m.payload as any)[mutField] === remap.oldId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(m.payload as any)[mutField] = remap.newId
      await tx.objectStore('report_mutations').put(m)
      result.remappedMutations++
    }
  }

  // 3. Catalogs cache
  const catKey = CATALOG_KEY[remap.kind]
  const catRec = await tx.objectStore('catalogs').get(catKey)
  if (catRec) {
    const list = catRec.payload as CachedNamedDict[] | null
    if (Array.isArray(list)) {
      const filtered = list.filter((it) => it.id !== remap.oldId)
      // newId должен быть уже в кэше после успешного POST; если нет —
      // следующий loadWorkTypes() подтянет, не критично.
      if (filtered.length !== list.length) {
        await tx.objectStore('catalogs').put({
          key: catKey,
          payload: filtered,
          updatedAt: Date.now(),
        })
        result.catalogPatched = true
      }
    }
  }

  // 4. Удаляем local-draft с oldId — он больше не нужен.
  const localStore = tx.objectStore(LOCAL_STORE[remap.kind])
  const localDraft = await localStore.get(remap.oldId)
  if (localDraft) {
    await localStore.delete(remap.oldId)
    result.removedLocalDraft = true
  }

  await tx.done
  return result
}

/**
 * Переставляет nextAttemptAt = now() для всех sync_queue items с указанным
 * reportId (только kind = 'report'/'report_update'/'report_delete'/'mark'/'mark_update'/'photo'/'photo_delete').
 * Используется после ремапа справочника, чтобы зависевший отчёт ушёл сразу
 * с правильным id.
 */
export async function bumpReportSyncOps(reportIds: string[]): Promise<void> {
  if (reportIds.length === 0) return
  const db = await getDB()
  const tx = db.transaction('sync_queue', 'readwrite')
  const ops = await tx.store.getAll()
  const targets = new Set(reportIds)
  const nowMs = Date.now()
  for (const op of ops) {
    const rid = op.reportId ?? (op.kind === 'report' || op.kind === 'mark' ? op.entityId : null)
    if (rid && targets.has(rid)) {
      op.nextAttemptAt = nowMs
      // не сбрасываем attempts — backoff остаётся применимым
      await tx.store.put(op)
    }
  }
  await tx.done
}
