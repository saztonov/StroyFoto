import { Link } from "react-router";
import type { LocalSyncStatus } from "@stroyfoto/shared";
import type { LocalReport } from "../../db/dexie";
import { SyncStatusBadge } from "../SyncStatusBadge";
import type { ReportPhotoInfo } from "../../hooks/useReportThumbnails";
import { enqueueSyncOp } from "../../db/sync-queue";
import { useOnline } from "../../hooks/use-online";
import { useSync } from "../../hooks/use-sync";

const STATUS_BORDER: Record<LocalSyncStatus, string> = {
  draft: "border-l-gray-300",
  "local-only": "border-l-yellow-400",
  queued: "border-l-blue-400",
  syncing: "border-l-blue-400",
  synced: "border-l-green-400",
  error: "border-l-red-400",
};

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

interface ReportCardProps {
  report: LocalReport;
  photoInfo?: ReportPhotoInfo;
}

export function ReportCard({ report, photoInfo }: ReportCardProps) {
  const isOnline = useOnline();
  const { syncNow } = useSync();

  async function handleRetry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await import("../../db/dexie").then(({ db }) =>
      db.reports.update(report.clientId, { syncStatus: "local-only" }),
    );
    await enqueueSyncOp("UPSERT_REPORT", report.clientId);
    if (isOnline) syncNow();
  }

  const urls = photoInfo?.urls ?? [];
  const totalPhotos = photoInfo?.totalCount ?? 0;
  const extraPhotos = totalPhotos - urls.length;

  return (
    <Link
      to={`/reports/${report.clientId}`}
      className={`block rounded-xl border border-gray-200 border-l-4 bg-white p-2.5 shadow-sm transition hover:shadow-md ${STATUS_BORDER[report.syncStatus]}`}
    >
      {/* Row 1: time + work types + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="shrink-0 text-xs text-gray-400">{formatTime(report.dateTime)}</span>
            {report.workTypes.map((wt) => (
              <span
                key={wt}
                className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700"
              >
                {wt}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SyncStatusBadge status={report.syncStatus} />
          {report.syncStatus === "error" && (
            <button
              onClick={handleRetry}
              className="rounded-md bg-red-50 p-1 text-red-600 transition hover:bg-red-100"
              title="Повторить"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: contractor + own forces */}
      {(report.contractor || report.ownForces) && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          {report.contractor && (
            <span className="inline-flex items-center gap-1">
              <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
              </svg>
              {report.contractor}
            </span>
          )}
          {report.ownForces && (
            <span className="inline-flex items-center gap-1">
              <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197" />
              </svg>
              {report.ownForces}
            </span>
          )}
        </div>
      )}

      {/* Row 3: photo thumbnails */}
      {totalPhotos > 0 && (
        <div className="mt-1.5 flex gap-1">
          {urls.map((url, i) => (
            <div key={i} className="relative h-10 w-10 shrink-0 overflow-hidden rounded">
              <img src={url} alt="" className="h-full w-full object-cover" />
              {/* Show +N overlay on last thumbnail if there are more */}
              {i === urls.length - 1 && extraPhotos > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-semibold text-white">
                  +{extraPhotos}
                </div>
              )}
            </div>
          ))}
          {/* Placeholder for synced photos without local blob */}
          {urls.length === 0 && totalPhotos > 0 && (
            <div className="flex h-10 items-center gap-1 rounded bg-gray-100 px-2 text-xs text-gray-400">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
              </svg>
              {totalPhotos} фото
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
