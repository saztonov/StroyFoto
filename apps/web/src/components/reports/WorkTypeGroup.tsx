import type { LocalReport } from "../../db/dexie";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { ReportCard } from "./ReportCard";

interface WorkTypeGroupProps {
  workTypeLabel: string;
  reports: LocalReport[];
  thumbnails: Map<string, ReportPhotoInfo>;
}

export function WorkTypeGroup({ workTypeLabel, reports, thumbnails }: WorkTypeGroupProps) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="mb-1 text-xs font-medium text-gray-400 dark:text-gray-500">{workTypeLabel}</p>
      <div className="space-y-1.5">
        {reports.map((report) => (
          <ReportCard
            key={report.clientId}
            report={report}
            photoInfo={thumbnails.get(report.clientId)}
          />
        ))}
      </div>
    </div>
  );
}
