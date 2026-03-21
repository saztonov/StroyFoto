import { useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { LOCAL_SYNC_STATUSES, type LocalSyncStatus } from "@stroyfoto/shared";
import { db } from "../db/dexie";
import { enqueueSyncOp } from "../db/sync-queue";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { useOnline } from "../hooks/use-online";
import { useSync } from "../hooks/use-sync";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const STATUS_LABELS: Record<LocalSyncStatus, string> = {
  draft: "Черновик",
  "local-only": "Локальный",
  queued: "В очереди",
  syncing: "Синхр...",
  synced: "Синхр.",
  error: "Ошибка",
};

export function ReportsPage() {
  const isOnline = useOnline();
  const { syncNow, isSyncing } = useSync();

  // Filters
  const [statusFilter, setStatusFilter] = useState<LocalSyncStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const reports = useLiveQuery(
    () => {
      let query = db.reports.orderBy("dateTime").reverse();

      return query.filter((r) => {
        // exclude drafts from main list
        if (r.syncStatus === "draft") return false;
        if (statusFilter !== "all" && r.syncStatus !== statusFilter) return false;
        if (projectFilter && r.projectId !== projectFilter) return false;
        if (dateFrom) {
          const from = new Date(dateFrom);
          if (r.dateTime < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo + "T23:59:59");
          if (r.dateTime > to) return false;
        }
        return true;
      }).toArray();
    },
    [statusFilter, dateFrom, dateTo, projectFilter],
  );

  const photoCounts = useLiveQuery(async () => {
    const photos = await db.photos.toArray();
    const counts: Record<string, number> = {};
    for (const photo of photos) {
      counts[photo.reportClientId] = (counts[photo.reportClientId] ?? 0) + 1;
    }
    return counts;
  }, []);

  async function handleRetry(reportClientId: string) {
    await db.reports.update(reportClientId, { syncStatus: "local-only" });
    await enqueueSyncOp("UPSERT_REPORT", reportClientId);
    if (isOnline) syncNow();
  }

  if (reports === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Отчёты</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-200"
          >
            Фильтры
          </button>
          {isOnline && (
            <button
              onClick={() => syncNow()}
              disabled={isSyncing}
              className="rounded-lg bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-200 disabled:opacity-50"
            >
              {isSyncing ? "Синхр..." : "Обновить"}
            </button>
          )}
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-3">
          {/* Status chips */}
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Статус</p>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label="Все"
                active={statusFilter === "all"}
                onClick={() => setStatusFilter("all")}
              />
              {LOCAL_SYNC_STATUSES.filter((s) => s !== "draft").map((s) => (
                <FilterChip
                  key={s}
                  label={STATUS_LABELS[s]}
                  active={statusFilter === s}
                  onClick={() => setStatusFilter(s)}
                />
              ))}
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">С</p>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">По</p>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Project filter */}
          {projects && projects.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500">Проект</p>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">Все проекты</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Clear filters */}
          <button
            onClick={() => {
              setStatusFilter("all");
              setDateFrom("");
              setDateTo("");
              setProjectFilter("");
            }}
            className="text-xs text-blue-600 hover:underline"
          >
            Сбросить фильтры
          </button>
        </div>
      )}

      {reports.length === 0 ? (
        <div className="mt-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
            <svg className="h-8 w-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="text-gray-500">Нет отчётов. Создайте первый!</p>
          <Link
            to="/reports/new"
            className="mt-4 inline-block rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Создать отчёт
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <Link
              to={`/reports/${report.clientId}`}
              key={report.clientId}
              className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <span className="text-sm font-semibold text-blue-600">{report.projectId}</span>
                  <p className="text-xs text-gray-400">{formatDate(report.dateTime)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <SyncStatusBadge status={report.syncStatus} />
                  {report.syncStatus === "error" && (
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRetry(report.clientId); }}
                      className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
                      title="Повторить"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1 text-sm text-gray-700">
                <div className="flex justify-between">
                  <span className="text-gray-500">Марка:</span>
                  <span className="font-medium">{report.mark}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Вид работ:</span>
                  <span className="font-medium">{report.workType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Участок:</span>
                  <span className="font-medium">{report.area}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Подрядчик:</span>
                  <span className="font-medium">{report.contractor}</span>
                </div>
              </div>

              {(photoCounts?.[report.clientId] ?? 0) > 0 && (
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                  </svg>
                  <span>{photoCounts![report.clientId]} фото</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-blue-600 text-white"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
