import type { ProjectGroup } from "../../hooks/useGroupedReports";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { DateGroup } from "./DateGroup";

interface ProjectSectionProps {
  group: ProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  thumbnails: Map<string, ReportPhotoInfo>;
}

export function ProjectSection({ group, expanded, onToggle, thumbnails }: ProjectSectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-gray-900">{group.projectName}</span>
          {group.projectCode && (
            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-blue-600">
              {group.projectCode}
            </span>
          )}
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
            {group.totalReports}
          </span>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
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
        <div className="border-t border-gray-100 px-3 pb-3 pt-2">
          {group.dates.map((dateGroup) => (
            <DateGroup
              key={dateGroup.dateKey}
              dateKey={dateGroup.dateKey}
              displayDate={dateGroup.displayDate}
              reports={dateGroup.reports}
              thumbnails={thumbnails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
