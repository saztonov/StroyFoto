import type { MonthGroup } from "../../hooks/useGroupedReports";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { DaySection } from "./DaySection";

interface MonthSectionProps {
  month: MonthGroup;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  expandedNodes: Set<string>;
  onToggleNode: (key: string) => void;
  thumbnails: Map<string, ReportPhotoInfo>;
}

export function MonthSection({
  month,
  projectId,
  expanded,
  onToggle,
  expandedNodes,
  onToggleNode,
  thumbnails,
}: MonthSectionProps) {
  return (
    <div className="mt-2 first:mt-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-1.5 text-left"
      >
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{month.displayMonth}</span>
        <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {month.totalReports}
        </span>
      </button>

      {expanded && (
        <div className="ml-4 mt-0.5">
          {month.days.map((day) => {
            const dayKey = `d:${projectId}:${day.dateKey}`;
            return (
              <DaySection
                key={day.dateKey}
                day={day}
                expanded={expandedNodes.has(dayKey)}
                onToggle={() => onToggleNode(dayKey)}
                thumbnails={thumbnails}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
