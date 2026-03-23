import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { LOCAL_SYNC_STATUSES, type LocalSyncStatus } from "@stroyfoto/shared";
import { db } from "../db/dexie";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../hooks/use-online";
import { useSync } from "../hooks/use-sync";
import { useGroupedReports } from "../hooks/useGroupedReports";
import { useReportThumbnails } from "../hooks/useReportThumbnails";
import { ProjectSection } from "../components/reports/ProjectSection";

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
  const { user } = useAuth();
  const profileId = user?.userId ?? "";

  // Filters
  const [statusFilter, setStatusFilter] = useState<LocalSyncStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const projects = useLiveQuery(
    () => profileId ? db.projects.where("scopeProfileId").equals(profileId).toArray() : db.projects.toArray(),
    [profileId],
  );

  const reports = useLiveQuery(
    () => {
      let query = db.reports.orderBy("dateTime").reverse();

      return query.filter((r) => {
        if (profileId && r.scopeProfileId !== profileId) return false;
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
    [statusFilter, dateFrom, dateTo, projectFilter, profileId],
  );

  const grouped = useGroupedReports(reports, projects);

  // Expanded state: default all expanded if <=3 projects, else first only
  const [expandedProjects, setExpandedProjects] = useState<Set<string> | null>(null);

  const effectiveExpanded = useMemo(() => {
    if (expandedProjects !== null) return expandedProjects;
    if (grouped.length === 0) return new Set<string>();
    if (grouped.length <= 3) return new Set(grouped.map((g) => g.projectId));
    return new Set([grouped[0].projectId]);
  }, [expandedProjects, grouped]);

  // Collect report IDs from expanded projects for thumbnail loading
  const visibleReportIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of grouped) {
      if (effectiveExpanded.has(group.projectId)) {
        for (const dateGroup of group.dates) {
          for (const report of dateGroup.reports) {
            ids.push(report.clientId);
          }
        }
      }
    }
    return ids;
  }, [grouped, effectiveExpanded]);

  const thumbnails = useReportThumbnails(visibleReportIds);

  function toggleProject(projectId: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev ?? effectiveExpanded);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
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
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Отчёты</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="rounded-lg bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 transition hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Фильтры
          </button>
          {isOnline && (
            <button
              onClick={() => syncNow()}
              disabled={isSyncing}
              className="rounded-lg bg-blue-100 dark:bg-blue-900/40 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 transition hover:bg-blue-200 dark:hover:bg-blue-800/40 disabled:opacity-50"
            >
              {isSyncing ? "Синхр..." : "Обновить"}
            </button>
          )}
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="mb-4 space-y-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
          {/* Status chips */}
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Статус</p>
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
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">С</p>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">По</p>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Project filter */}
          {projects && projects.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Проект</p>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1.5 text-sm"
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
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Сбросить фильтры
          </button>
        </div>
      )}

      {reports.length === 0 ? (
        <div className="mt-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
            <svg className="h-8 w-8 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400">Нет отчётов. Создайте первый!</p>
          <Link
            to="/reports/new"
            className="mt-4 inline-block rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Создать отчёт
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <ProjectSection
              key={group.projectId}
              group={group}
              expanded={effectiveExpanded.has(group.projectId)}
              onToggle={() => toggleProject(group.projectId)}
              thumbnails={thumbnails}
            />
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
          : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
      }`}
    >
      {label}
    </button>
  );
}
