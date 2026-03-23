import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalPhoto } from "../db/dexie";
import { fetchAndCacheThumbnails } from "../lib/thumbnail-fetcher";
import { useOnline } from "./use-online";

const MAX_THUMBNAILS = 4;

export interface ReportPhotoInfo {
  urls: string[];
  totalCount: number;
}

export function useReportThumbnails(
  reportClientIds: string[],
): Map<string, ReportPhotoInfo> {
  const isOnline = useOnline();
  const urlsRef = useRef<string[]>([]);
  const [result, setResult] = useState<Map<string, ReportPhotoInfo>>(new Map());

  const photos = useLiveQuery(
    async () => {
      if (reportClientIds.length === 0) return [];
      return db.photos.where("reportClientId").anyOf(reportClientIds).toArray();
    },
    [reportClientIds.join(",")],
  );

  useEffect(() => {
    if (!photos) return;

    // Revoke previous URLs
    for (const url of urlsRef.current) {
      URL.revokeObjectURL(url);
    }
    urlsRef.current = [];

    // Group by reportClientId
    const grouped = new Map<string, LocalPhoto[]>();
    for (const p of photos) {
      if (!grouped.has(p.reportClientId)) grouped.set(p.reportClientId, []);
      grouped.get(p.reportClientId)!.push(p);
    }

    const newResult = new Map<string, ReportPhotoInfo>();

    for (const [reportId, reportPhotos] of grouped) {
      const totalCount = reportPhotos.length;
      const urls: string[] = [];

      for (const photo of reportPhotos.slice(0, MAX_THUMBNAILS)) {
        const blob = photo.thumbnail?.size ? photo.thumbnail : photo.blob?.size ? photo.blob : null;
        if (blob) {
          const url = URL.createObjectURL(blob);
          urls.push(url);
          urlsRef.current.push(url);
        }
      }

      newResult.set(reportId, { urls, totalCount });
    }

    // Include reports with 0 photos as empty
    for (const id of reportClientIds) {
      if (!newResult.has(id)) {
        newResult.set(id, { urls: [], totalCount: 0 });
      }
    }

    setResult(newResult);

    // Lazy-fetch thumbnails from server for synced photos without local blobs
    if (isOnline) {
      const needsFetch = photos.filter(
        (p) => p.serverId && !(p.thumbnail?.size) && !(p.blob?.size),
      );
      if (needsFetch.length > 0) fetchAndCacheThumbnails(needsFetch);
    }
  }, [photos, reportClientIds, isOnline]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return result;
}
