import type { LocalReport } from "../../db/dexie";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { ReportCard } from "./ReportCard";

interface DateGroupProps {
  dateKey: string;
  displayDate: string;
  reports: LocalReport[];
  thumbnails: Map<string, ReportPhotoInfo>;
}

export function DateGroup({ displayDate, reports, thumbnails }: DateGroupProps) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="mb-1 text-xs font-medium text-gray-400">{displayDate}</p>
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
