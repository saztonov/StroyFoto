import type { ProjectGroup } from "../../hooks/useGroupedReports";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { MonthSection } from "./MonthSection";

interface ProjectSectionProps {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  expandedNodes: Set<string>;
  onToggleNode: (key: string) => void;
  thumbnails: Map<string, ReportPhotoInfo>;
}

export function ProjectSection({
  group,
  expanded,
  onToggle,
  expandedNodes,
  onToggleNode,
  thumbnails,
}: ProjectSectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{group.projectName}</span>
          {group.projectCode && (
            <span className="shrink-0 rounded bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-600 dark:text-blue-400">
              {group.projectCode}
            </span>
          )}
          <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
            {group.totalReports}
          </span>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-3 pb-3 pt-1">
          {group.months.map((month) => {
            const monthKey = `m:${group.projectId}:${month.monthKey}`;
            return (
              <MonthSection
                key={month.monthKey}
                month={month}
                projectId={group.projectId}
                expanded={expandedNodes.has(monthKey)}
                onToggle={() => onToggleNode(monthKey)}
                expandedNodes={expandedNodes}
                onToggleNode={onToggleNode}
                thumbnails={thumbnails}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
