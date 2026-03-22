import { useState, useMemo, useCallback, useEffect, type FormEvent } from "react";
import { useNavigate, useParams, Link } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { WORK_TYPES, createReportSchema, MAX_PHOTOS_PER_REPORT } from "@stroyfoto/shared";
import { db, type LocalPhoto } from "../db/dexie";
import { enqueueSyncOp } from "../db/sync-queue";
import { useAuth } from "../auth/auth-context";
import { PhotoCapture, type ProcessedPhoto } from "../components/PhotoCapture";
import { processPhoto } from "../lib/image-processing";
import { FilterableSelect } from "../components/FilterableSelect";
import { FilterableMultiSelect } from "../components/FilterableMultiSelect";

function toLocalDateTimeString(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function EditReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { clientId } = useParams<{ clientId: string }>();

  const report = useLiveQuery(
    () => (clientId ? db.reports.get(clientId) : undefined),
    [clientId],
  );

  const existingPhotos = useLiveQuery(
    () => (clientId ? db.photos.where("reportClientId").equals(clientId).toArray() : []),
    [clientId],
  );

  // Form state
  const [projectId, setProjectId] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [workTypes, setWorkTypes] = useState<string[]>([]);
  const [contractor, setContractor] = useState("");
  const [ownForces, setOwnForces] = useState("");
  const [description, setDescription] = useState("");
  const [newPhotos, setNewPhotos] = useState<ProcessedPhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Pre-fill form from existing report
  useEffect(() => {
    if (report && !loaded) {
      setProjectId(report.projectId);
      setDateTime(toLocalDateTimeString(report.dateTime));
      setWorkTypes(report.workTypes);
      setContractor(report.contractor);
      setOwnForces(report.ownForces);
      setDescription(report.description);
      setLoaded(true);
    }
  }, [report, loaded]);

  // Reference data from Dexie
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const dbWorkTypes = useLiveQuery(() => db.workTypes.toArray(), []);
  const contractors = useLiveQuery(() => db.contractors.toArray(), []);
  const ownForcesList = useLiveQuery(() => db.ownForces.toArray(), []);

  const workTypeOptions = useMemo(() => {
    if (dbWorkTypes && dbWorkTypes.length > 0) return dbWorkTypes.map((wt) => wt.name);
    return [...WORK_TYPES];
  }, [dbWorkTypes]);

  const projectOptions = useMemo(() => {
    if (!projects) return [];
    return projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  }, [projects]);

  const workTypeSelectOptions = useMemo(() => {
    return workTypeOptions.map((wt) => ({ value: wt, label: wt }));
  }, [workTypeOptions]);

  const contractorOptions = useMemo(() => {
    if (!contractors) return [];
    return contractors.map((c) => ({ value: c.name, label: c.name }));
  }, [contractors]);

  const ownForcesOptions = useMemo(() => {
    if (!ownForcesList) return [];
    return ownForcesList.map((o) => ({ value: o.name, label: o.name }));
  }, [ownForcesList]);

  const handleCreateWorkType = useCallback(async (name: string) => {
    await db.workTypes.add({
      id: crypto.randomUUID(),
      name,
      updatedAt: new Date(),
    });
  }, []);

  // Total photos = existing (minus removed) + new
  const keptExisting = (existingPhotos ?? []).filter((p) => !removedPhotoIds.has(p.clientId));
  const totalPhotos = keptExisting.length + newPhotos.length;

  // Photo URLs for existing photos
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!existingPhotos || existingPhotos.length === 0) return;
    const urls = new Map<string, string>();
    const objectUrls: string[] = [];

    for (const photo of existingPhotos) {
      if (photo.blob && photo.blob.size > 0) {
        const url = URL.createObjectURL(photo.blob);
        urls.set(photo.clientId, url);
        objectUrls.push(url);
      } else if (photo.thumbnail && photo.thumbnail.size > 0) {
        const url = URL.createObjectURL(photo.thumbnail);
        urls.set(photo.clientId, url);
        objectUrls.push(url);
      }
    }
    setPhotoUrls(new Map(urls));
    return () => {
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [existingPhotos]);

  const handleAddPhotos = useCallback(
    async (files: File[]) => {
      setIsProcessing(true);
      setError("");

      try {
        const remaining = MAX_PHOTOS_PER_REPORT - totalPhotos;
        if (remaining <= 0) {
          setError(`Максимум ${MAX_PHOTOS_PER_REPORT} фото на отчёт`);
          return;
        }

        const filesToProcess = files.slice(0, remaining);
        const existingHashes = new Set([
          ...newPhotos.map((p) => p.hash).filter(Boolean),
          ...keptExisting.map((p) => p.hash).filter(Boolean),
        ]);

        const results: ProcessedPhoto[] = [];
        const errors: string[] = [];

        for (const file of filesToProcess) {
          try {
            const processed = await processPhoto(file);
            if (processed.hash && existingHashes.has(processed.hash)) {
              errors.push(`${file.name}: дубликат пропущен`);
              continue;
            }
            existingHashes.add(processed.hash);
            results.push({
              clientId: crypto.randomUUID(),
              blob: processed.blob,
              thumbnail: processed.thumbnail,
              mimeType: processed.mimeType,
              fileName: file.name,
              size: processed.size,
              hash: processed.hash,
            });
          } catch (err) {
            errors.push(err instanceof Error ? err.message : `${file.name}: ошибка`);
          }
        }

        if (results.length > 0) setNewPhotos((prev) => [...prev, ...results]);
        if (errors.length > 0) setError(errors.join("; "));
      } finally {
        setIsProcessing(false);
      }
    },
    [totalPhotos, newPhotos, keptExisting],
  );

  const handleRemoveExistingPhoto = useCallback((photoClientId: string) => {
    setRemovedPhotoIds((prev) => new Set(prev).add(photoClientId));
  }, []);

  const handleRemoveNewPhoto = useCallback((photoClientId: string) => {
    setNewPhotos((prev) => prev.filter((p) => p.clientId !== photoClientId));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!user || !clientId) {
      setError("Пользователь не авторизован");
      return;
    }

    const parsed = createReportSchema.safeParse({
      clientId,
      projectId: projectId.trim(),
      dateTime: new Date(dateTime),
      workTypes,
      contractor: contractor.trim(),
      ownForces: ownForces.trim(),
      description: description.trim(),
    });

    if (!parsed.success) {
      const firstError = parsed.error.errors[0];
      setError(firstError?.message ?? "Проверьте заполненность полей");
      return;
    }

    setSubmitting(true);

    try {
      const now = new Date();

      // Update report
      await db.reports.put({
        clientId,
        serverId: report?.serverId,
        projectId: parsed.data.projectId,
        dateTime: parsed.data.dateTime,
        workTypes: parsed.data.workTypes,
        contractor: parsed.data.contractor,
        ownForces: parsed.data.ownForces,
        description: parsed.data.description,
        userId: user.userId,
        syncStatus: "local-only",
        createdAt: report?.createdAt ?? now,
        updatedAt: now,
      });

      // Remove deleted photos
      for (const photoId of removedPhotoIds) {
        await db.syncQueue.where("entityClientId").equals(photoId).delete();
        await db.photos.delete(photoId);
      }

      // Add new photos
      for (const photo of newPhotos) {
        await db.photos.add({
          clientId: photo.clientId,
          reportClientId: clientId,
          blob: photo.blob,
          thumbnail: photo.thumbnail,
          mimeType: photo.mimeType,
          fileName: photo.fileName,
          size: photo.size,
          hash: photo.hash,
          localStatus: "ready",
          syncStatus: "pending",
          createdAt: now,
        });
        await enqueueSyncOp("UPLOAD_PHOTO", photo.clientId);
      }

      // Re-enqueue report sync
      await enqueueSyncOp("UPSERT_REPORT", clientId);

      showToast("Изменения сохранены");
      setTimeout(() => navigate(`/reports/${clientId}`), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSubmitting(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
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
        <p className="text-gray-500">Отчёт не найден</p>
        <Link to="/reports" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Вернуться к отчётам
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <Link to={`/reports/${clientId}`} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
          Назад
        </Link>
        <h2 className="text-xl font-bold text-gray-900">Редактирование</h2>
      </div>

      {toast && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {toast}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Проект" required>
          {projectOptions.length > 0 ? (
            <FilterableSelect
              options={projectOptions}
              value={projectId}
              onChange={setProjectId}
              placeholder="Выберите проект"
              required
            />
          ) : (
            <input
              type="text"
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Идентификатор проекта"
              className="input-field"
            />
          )}
        </Field>

        <Field label="Дата и время" required>
          <input
            type="datetime-local"
            required
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            className="input-field"
          />
        </Field>

        <Field label="Вид работ" required>
          <FilterableMultiSelect
            options={workTypeSelectOptions}
            values={workTypes}
            onChange={setWorkTypes}
            onCreateNew={handleCreateWorkType}
            placeholder="Выберите виды работ"
            required
          />
        </Field>

        <Field label="Подрядчик" required>
          {contractorOptions.length > 0 ? (
            <FilterableSelect
              options={contractorOptions}
              value={contractor}
              onChange={setContractor}
              placeholder="Выберите подрядчика"
              required
            />
          ) : (
            <input
              type="text"
              required
              value={contractor}
              onChange={(e) => setContractor(e.target.value)}
              placeholder="Название подрядчика"
              className="input-field"
            />
          )}
        </Field>

        <Field label="Собственные силы">
          {ownForcesOptions.length > 0 ? (
            <FilterableSelect
              options={ownForcesOptions}
              value={ownForces}
              onChange={setOwnForces}
              placeholder="Выберите (необязательно)"
            />
          ) : (
            <input
              type="text"
              value={ownForces}
              onChange={(e) => setOwnForces(e.target.value)}
              placeholder="Собственные силы (необязательно)"
              className="input-field"
            />
          )}
        </Field>

        <Field label="Описание">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Дополнительное описание (необязательно)"
            rows={3}
            className="input-field resize-none"
          />
        </Field>

        {/* Existing photos */}
        {keptExisting.length > 0 && (
          <Field label={`Существующие фото (${keptExisting.length})`}>
            <div className="grid grid-cols-4 gap-2">
              {keptExisting.map((photo) => {
                const url = photoUrls.get(photo.clientId);
                return (
                  <div key={photo.clientId} className="relative">
                    {url ? (
                      <img src={url} alt={photo.fileName} className="aspect-square w-full rounded-lg object-cover" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-gray-100">
                        <span className="text-xs text-gray-400">Фото</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveExistingPhoto(photo.clientId)}
                      className="absolute -right-1 -top-1 rounded-full bg-red-500 p-0.5 text-white shadow hover:bg-red-600"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </Field>
        )}

        {/* New photos */}
        <Field label={`Добавить фото (всего: ${totalPhotos}/${MAX_PHOTOS_PER_REPORT})`}>
          <PhotoCapture
            photos={newPhotos}
            onAdd={handleAddPhotos}
            onRemove={handleRemoveNewPhoto}
            isProcessing={isProcessing}
            disabled={totalPhotos >= MAX_PHOTOS_PER_REPORT}
          />
        </Field>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || isProcessing}
          className="w-full rounded-xl bg-blue-600 py-3.5 text-base font-semibold text-white transition hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Сохранение..." : "Сохранить изменения"}
        </button>
      </form>

      <style>{`
        .input-field {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #d1d5db;
          padding: 0.75rem 1rem;
          font-size: 1rem;
          transition: all 150ms;
          background: white;
        }
        .input-field:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
