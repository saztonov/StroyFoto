/**
 * Видимые пользователю проблемы синхронизации: OCC-конфликты, FK_VIOLATION,
 * permanent ошибки от сервера. Раньше такие случаи приводили к «тихому»
 * `db.delete('report_mutations')` — пользователь терял правки без объяснения.
 * Теперь каждая такая ситуация фиксируется в IDB store `sync_issues`,
 * показывается в SyncBanner и на карточке отчёта; пользователь подтверждает
 * («Понятно») — issue помечается ackAt и больше не отвлекает.
 */

import { getDB, type CatalogKind, type SyncIssue, type SyncIssueKind } from '@/lib/db'

export interface RecordSyncIssueInput {
  reportId: string
  kind: SyncIssueKind
  message: string
  batchId?: string | null
  catalogKind?: CatalogKind | null
  catalogId?: string | null
}

export async function recordSyncIssue(input: RecordSyncIssueInput): Promise<void> {
  const db = await getDB()

  // Дедупликация для dict_blocked: операция откладывается и ретраится каждые
  // несколько часов, без этого по одному и тому же справочнику накопился бы
  // десяток одинаковых записей в баннере.
  if (input.catalogKind && input.catalogId) {
    const existing = await db.getAllFromIndex('sync_issues', 'by_report', input.reportId)
    const dup = existing.some(
      (i) =>
        !i.ackAt &&
        i.kind === input.kind &&
        i.catalogKind === input.catalogKind &&
        i.catalogId === input.catalogId,
    )
    if (dup) return
  }

  const issue: SyncIssue = {
    reportId: input.reportId,
    kind: input.kind,
    message: input.message,
    detectedAt: Date.now(),
    ackAt: null,
    batchId: input.batchId ?? null,
    catalogKind: input.catalogKind ?? null,
    catalogId: input.catalogId ?? null,
  }
  try {
    await db.add('sync_issues', issue)
  } catch (e) {
    console.warn('recordSyncIssue: failed to add', e)
  }
}

/**
 * Закрывает все открытые dict_blocked-issue по конкретной позиции справочника.
 * Вызывается после успешного разрешения (админ завёл/вернул позицию, либо
 * пользователь заменил её вручную) — иначе SyncBanner продолжает показывать
 * уже решённую проблему до перезагрузки.
 */
export async function closeCatalogIssues(
  catalogKind: CatalogKind,
  catalogId: string,
): Promise<void> {
  const db = await getDB()
  const all = await db.getAll('sync_issues')
  const now = Date.now()
  for (const issue of all) {
    if (issue.ackAt) continue
    if (issue.catalogKind !== catalogKind || issue.catalogId !== catalogId) continue
    issue.ackAt = now
    await db.put('sync_issues', issue)
  }
}

export async function listOpenSyncIssues(): Promise<SyncIssue[]> {
  const db = await getDB()
  const all = await db.getAll('sync_issues')
  return all.filter((i) => !i.ackAt).sort((a, b) => b.detectedAt - a.detectedAt)
}

export async function listSyncIssuesForReport(reportId: string): Promise<SyncIssue[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('sync_issues', 'by_report', reportId)
  return all.filter((i) => !i.ackAt).sort((a, b) => b.detectedAt - a.detectedAt)
}

export async function ackSyncIssue(id: number): Promise<void> {
  const db = await getDB()
  const issue = await db.get('sync_issues', id)
  if (!issue) return
  issue.ackAt = Date.now()
  await db.put('sync_issues', issue)
}

export async function ackSyncIssuesForReport(reportId: string): Promise<void> {
  const db = await getDB()
  const issues = await db.getAllFromIndex('sync_issues', 'by_report', reportId)
  const now = Date.now()
  for (const issue of issues) {
    if (issue.ackAt) continue
    issue.ackAt = now
    await db.put('sync_issues', issue)
  }
}

export async function countOpenSyncIssues(): Promise<number> {
  const db = await getDB()
  const all = await db.getAll('sync_issues')
  let count = 0
  for (const issue of all) if (!issue.ackAt) count++
  return count
}
