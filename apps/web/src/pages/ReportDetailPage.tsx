import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalPhoto } from "../db/dexie";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { getValidToken } from "../api/token-helper";
import { deleteReportFull } from "../db/report-utils";
import { useOnline } from "../hooks/use-online";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ReportDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const isOnline = useOnline();

  const report = useLiveQuery(
    () => (clientId ? db.reports.get(clientId) : undefined),
    [clientId],
  );

  const photos = useLiveQuery(
    () => (clientId ? db.photos.where("reportClientId").equals(clientId).toArray() : []),
    [clientId],
  );

  const projects = useLiveQuery(() => db.projects.toArray(), []);

  // Photo URLs management — use ref to persist URLs across re-renders
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const loadPhoto = useCallback(async (photo: LocalPhoto) => {
    // Already loading
    if (loadingRef.current.has(photo.clientId)) return;

    const hasFullBlob = photo.blob && photo.blob.size > 0;

    // Full-size blob available locally — use it directly
    if (hasFullBlob) {
      if (urlsRef.current.has(photo.clientId)) return;
      const url = URL.createObjectURL(photo.blob);
      urlsRef.current.set(photo.clientId, url);
      setPhotoUrls(new Map(urlsRef.current));
      return;
    }

    // Show thumbnail as temporary preview while fetching full image
    if (photo.thumbnail && photo.thumbnail.size > 0 && !urlsRef.current.has(photo.clientId)) {
      const url = URL.createObjectURL(photo.thumbnail);
      urlsRef.current.set(photo.clientId, url);
      setPhotoUrls(new Map(urlsRef.current));
    }

    // Fetch full-size image from server (replaces thumbnail if shown)
    if (photo.serverId) {
      loadingRef.current.add(photo.clientId);
      try {
        const token = await getValidToken();
        const res = await fetch(`${BASE_URL}/api/photos/${photo.serverId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (res.ok) {
          const blob = await res.blob();
          const prevUrl = urlsRef.current.get(photo.clientId);
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          const url = URL.createObjectURL(blob);
          urlsRef.current.set(photo.clientId, url);
          setPhotoUrls(new Map(urlsRef.current));
        }
      } catch {
        // keep thumbnail if fetch fails
      } finally {
        loadingRef.current.delete(photo.clientId);
      }
    }
  }, []);

  useEffect(() => {
    if (!photos || photos.length === 0) return;
    photos.forEach(loadPhoto);
  }, [photos, loadPhoto]);

  // Revoke all object URLs on unmount only
  useEffect(() => {
    return () => {
      for (const url of urlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      urlsRef.current.clear();
    };
  }, []);

  const lightboxPhotos = useMemo(() => {
    if (!photos) return [];
    return photos
      .map((p) => ({
        url: photoUrls.get(p.clientId) ?? "",
        fileName: p.fileName,
      }))
      .filter((p) => p.url !== "");
  }, [photos, photoUrls]);

  const projectName = useMemo(() => {
    if (!report || !projects) return report?.projectId ?? "";
    const project = projects.find((p) => p.id === report.projectId || p.code === report.projectId);
    return project?.name ?? report.projectId;
  }, [report, projects]);

  async function handleDelete() {
    if (!clientId) return;
    const confirmed = window.confirm("Удалить этот отчёт и все связанные фотографии?");
    if (!confirmed) return;

    await deleteReportFull(clientId);
    navigate("/reports");
  }

  if (report === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="px-4 py-20 text-center">
        <p className="text-gray-500 dark:text-gray-400">Отчёт не найден</p>
        <Link to="/reports" className="mt-4 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Вернуться к отчётам
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <Link to="/reports" className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          К отчётам
        </Link>
        <SyncStatusBadge status={report.syncStatus} />
      </div>

      {/* Report data card */}
      <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{projectName}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(report.dateTime)}</span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Вид работ:</span>
            <span className="font-medium text-gray-900 dark:text-gray-100 text-right">{report.workTypes.join(", ")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Подрядчик:</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{report.contractor}</span>
          </div>
          {report.ownForces && (
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Собственные силы:</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{report.ownForces}</span>
            </div>
          )}
        </div>

        {report.description && (
          <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-3">
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Описание</p>
            <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{report.description}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
          <Link
            to={`/reports/${clientId}/edit`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 transition hover:bg-blue-100 dark:hover:bg-blue-900/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
            </svg>
            Редактировать
          </Link>
          <button
            onClick={handleDelete}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-50 dark:bg-red-900/30 py-2 text-sm font-medium text-red-700 dark:text-red-300 transition hover:bg-red-100 dark:hover:bg-red-900/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
            Удалить
          </button>
        </div>
      </div>

      {/* Photos section */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
          Фотографии ({photos?.length ?? 0})
        </h3>

        {photos && photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, idx) => {
              const url = photoUrls.get(photo.clientId);
              const hasLocalBlob = photo.blob && photo.blob.size > 0;
              if (!url) {
                // Offline and no local blob — show placeholder
                if (!isOnline && !hasLocalBlob) {
                  return (
                    <div
                      key={photo.clientId}
                      className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-700 p-2"
                    >
                      <svg className="h-6 w-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                      </svg>
                      <span className="text-center text-[10px] text-gray-400 dark:text-gray-500">Доступно онлайн</span>
                    </div>
                  );
                }
                // Online but still loading
                return (
                  <div
                    key={photo.clientId}
                    className="flex aspect-square items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700"
                  >
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  </div>
                );
              }
              return (
                <button
                  key={photo.clientId}
                  onClick={() => {
                    const lightboxIdx = lightboxPhotos.findIndex((p) => p.url === url);
                    setLightboxIndex(lightboxIdx >= 0 ? lightboxIdx : 0);
                  }}
                  className="overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <img
                    src={url}
                    alt={photo.fileName ?? `Фото ${idx + 1}`}
                    className="aspect-square w-full object-cover transition hover:opacity-90"
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-4">Нет прикреплённых фотографий</p>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && lightboxPhotos.length > 0 && (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
