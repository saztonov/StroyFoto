import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/dexie";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../hooks/use-online";
import { useSync } from "../hooks/use-sync";
import { useGroupedReports } from "../hooks/useGroupedReports";
import { useReportThumbnails } from "../hooks/useReportThumbnails";
import { ProjectSection } from "../components/reports/ProjectSection";
import { ReportFilters } from "../components/reports/ReportFilters";

export function ReportsPage() {
  const isOnline = useOnline();
  const { syncNow, isSyncing } = useSync();
  const { user } = useAuth();
  const profileId = user?.userId ?? "";

  // Filters
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [contractorFilter, setContractorFilter] = useState("");
  const [descriptionSearch, setDescriptionSearch] = useState("");
  const [workTypeFilter, setWorkTypeFilter] = useState<string[]>([]);

  const deferredSearch = useDeferredValue(descriptionSearch);

  const projects = useLiveQuery(
    () => profileId ? db.projects.where("scopeProfileId").equals(profileId).toArray() : db.projects.toArray(),
    [profileId],
  );

  const contractors = useLiveQuery(
    () => profileId ? db.contractors.where("scopeProfileId").equals(profileId).toArray() : db.contractors.toArray(),
    [profileId],
  );

  const workTypes = useLiveQuery(
    () => profileId ? db.workTypes.where("scopeProfileId").equals(profileId).toArray() : db.workTypes.toArray(),
    [profileId],
  );

  const contractorOptions = useMemo(
    () => (contractors ?? []).map((c) => ({ value: c.name, label: c.name })),
    [contractors],
  );

  const workTypeOptions = useMemo(
    () => (workTypes ?? []).map((wt) => ({ value: wt.name, label: wt.name })),
    [workTypes],
  );

  const reports = useLiveQuery(
    () => {
      const query = db.reports.orderBy("dateTime").reverse();

      return query.filter((r) => {
        if (profileId && r.scopeProfileId !== profileId) return false;
        if (r.syncStatus === "draft") return false;
        if (dateFrom) {
          const from = new Date(dateFrom);
          if (r.dateTime < from) return false;
        }
        if (dateTo) {
          const to = new Date(dateTo + "T23:59:59");
          if (r.dateTime > to) return false;
        }
        if (contractorFilter && r.contractor !== contractorFilter) return false;
        if (deferredSearch && !r.description.toLowerCase().includes(deferredSearch.toLowerCase())) return false;
        if (workTypeFilter.length > 0 && !workTypeFilter.some((wt) => r.workTypes.includes(wt))) return false;
        return true;
      }).toArray();
    },
    [dateFrom, dateTo, contractorFilter, deferredSearch, workTypeFilter, profileId],
  );

  const grouped = useGroupedReports(reports, projects);

  // Expansion state: unified Set with composite keys
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const defaultApplied = useRef(false);

  useEffect(() => {
    if (grouped.length > 0 && !defaultApplied.current) {
      defaultApplied.current = true;
      const initial = new Set<string>();
      const projectsToExpand = grouped.length <= 3 ? grouped : [grouped[0]];
      for (const pg of projectsToExpand) {
        initial.add(`p:${pg.projectId}`);
        if (pg.months.length > 0) {
          const latestMonth = pg.months[0];
          initial.add(`m:${pg.projectId}:${latestMonth.monthKey}`);
          if (latestMonth.days.length > 0) {
            initial.add(`d:${pg.projectId}:${latestMonth.days[0].dateKey}`);
          }
        }
      }
      setExpandedNodes(initial);
    }
  }, [grouped]);

  function toggleNode(key: string) {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Collect report IDs from fully expanded paths for thumbnail loading
  const visibleReportIds = useMemo(() => {
    const ids: string[] = [];
    for (const pg of grouped) {
      if (!expandedNodes.has(`p:${pg.projectId}`)) continue;
      for (const mg of pg.months) {
        if (!expandedNodes.has(`m:${pg.projectId}:${mg.monthKey}`)) continue;
        for (const dg of mg.days) {
          if (!expandedNodes.has(`d:${pg.projectId}:${dg.dateKey}`)) continue;
          for (const cluster of dg.workTypeClusters) {
            for (const report of cluster.reports) {
              ids.push(report.clientId);
            }
          }
        }
      }
    }
    return ids;
  }, [grouped, expandedNodes]);

  const thumbnails = useReportThumbnails(visibleReportIds);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setContractorFilter("");
    setDescriptionSearch("");
    setWorkTypeFilter([]);
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

      {/* Filters — always visible */}
      <ReportFilters
        dateFrom={dateFrom}
        dateTo={dateTo}
        contractorFilter={contractorFilter}
        descriptionSearch={descriptionSearch}
        workTypeFilter={workTypeFilter}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onContractorChange={setContractorFilter}
        onDescriptionChange={setDescriptionSearch}
        onWorkTypeChange={setWorkTypeFilter}
        onClear={clearFilters}
        contractorOptions={contractorOptions}
        workTypeOptions={workTypeOptions}
      />

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
              expanded={expandedNodes.has(`p:${group.projectId}`)}
              onToggle={() => toggleNode(`p:${group.projectId}`)}
              expandedNodes={expandedNodes}
              onToggleNode={toggleNode}
              thumbnails={thumbnails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
