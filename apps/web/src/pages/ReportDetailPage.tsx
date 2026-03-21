import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type LocalPhoto } from "../db/dexie";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { getValidToken } from "../api/token-manager";

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

  const report = useLiveQuery(
    () => (clientId ? db.reports.get(clientId) : undefined),
    [clientId],
  );

  const photos = useLiveQuery(
    () => (clientId ? db.photos.where("reportClientId").equals(clientId).toArray() : []),
    [clientId],
  );

  const projects = useLiveQuery(() => db.projects.toArray(), []);

  // Photo URLs management
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Create object URLs for local blobs, fetch presigned URLs for server photos
  useEffect(() => {
    if (!photos || photos.length === 0) return;

    const urls = new Map<string, string>();
    const objectUrls: string[] = [];

    async function loadUrls(photoList: LocalPhoto[]) {
      for (const photo of photoList) {
        if (photo.blob && photo.blob.size > 0) {
          const url = URL.createObjectURL(photo.blob);
          urls.set(photo.clientId, url);
          objectUrls.push(url);
        } else if (photo.thumbnail && photo.thumbnail.size > 0) {
          const url = URL.createObjectURL(photo.thumbnail);
          urls.set(photo.clientId, url);
          objectUrls.push(url);
        } else if (photo.serverId) {
          try {
            const token = await getValidToken();
            const res = await fetch(`${BASE_URL}/api/photos/${photo.serverId}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
              redirect: "follow",
            });
            if (res.ok) {
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              urls.set(photo.clientId, url);
              objectUrls.push(url);
            }
          } catch {
            // skip failed photos
          }
        }
      }
      setPhotoUrls(new Map(urls));
    }

    loadUrls(photos);

    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [photos]);

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
        <p className="text-gray-500">Отчёт не найден</p>
        <Link to="/reports" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Вернуться к отчётам
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <Link to="/reports" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          К отчётам
        </Link>
        <SyncStatusBadge status={report.syncStatus} />
      </div>

      {/* Report data card */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">{projectName}</h2>
          <span className="text-xs text-gray-400">{formatDate(report.dateTime)}</span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Марка / Оси:</span>
            <span className="font-medium text-gray-900">{report.mark}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Вид работ:</span>
            <span className="font-medium text-gray-900">{report.workType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Участок:</span>
            <span className="font-medium text-gray-900">{report.area}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Подрядчик:</span>
            <span className="font-medium text-gray-900">{report.contractor}</span>
          </div>
        </div>

        {report.description && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-1 text-xs font-medium text-gray-500">Описание</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{report.description}</p>
          </div>
        )}
      </div>

      {/* Photos section */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Фотографии ({photos?.length ?? 0})
        </h3>

        {photos && photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, idx) => {
              const url = photoUrls.get(photo.clientId);
              if (!url) {
                return (
                  <div
                    key={photo.clientId}
                    className="flex aspect-square items-center justify-center rounded-lg bg-gray-100"
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
          <p className="text-center text-sm text-gray-400 py-4">Нет прикреплённых фотографий</p>
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
