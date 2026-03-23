import type { DayGroup } from "../../hooks/useGroupedReports";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { WorkTypeGroup } from "./WorkTypeGroup";

interface DaySectionProps {
  day: DayGroup;
  expanded: boolean;
  onToggle: () => void;
  thumbnails: Map<string, ReportPhotoInfo>;
}

export function DaySection({ day, expanded, onToggle, thumbnails }: DaySectionProps) {
  return (
    <div className="mt-1.5 first:mt-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-1 text-left"
      >
        <svg
          className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{day.displayDate}</span>
        <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 dark:text-gray-500">
          {day.totalReports}
        </span>
      </button>

      {expanded && (
        <div className="ml-5 mt-1">
          {day.workTypeClusters.map((cluster) => (
            <WorkTypeGroup
              key={cluster.workTypeKey}
              workTypeLabel={cluster.workTypeLabel}
              reports={cluster.reports}
              thumbnails={thumbnails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
