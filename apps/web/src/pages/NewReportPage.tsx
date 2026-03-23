import { useState, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { createReportSchema, MAX_PHOTOS_PER_REPORT } from "@stroyfoto/shared";
import { db } from "../db/dexie";
import { enqueueSyncOp } from "../db/sync-queue";
import { useAuth } from "../auth/auth-context";
import { useAutosave } from "../hooks/use-autosave";
import { PhotoCapture, type ProcessedPhoto } from "../components/PhotoCapture";
import { processPhoto } from "../lib/image-processing";
import { FilterableSelect } from "../components/FilterableSelect";
import { FilterableMultiSelect } from "../components/FilterableMultiSelect";
import { createLocalDictionaryItem } from "../db/dictionary-helpers";

function toLocalDateTimeString(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function NewReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [clientId] = useState(() => crypto.randomUUID());
  const [projectId, setProjectId] = useState("");
  const [dateTime, setDateTime] = useState(toLocalDateTimeString(new Date()));
  const [workTypes, setWorkTypes] = useState<string[]>([]);
  const [contractor, setContractor] = useState("");
  const [ownForces, setOwnForces] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<ProcessedPhoto[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");

  // Reference data from Dexie
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const dbWorkTypes = useLiveQuery(() => db.workTypes.toArray(), []);
  const contractors = useLiveQuery(() => db.contractors.toArray(), []);
  const ownForcesList = useLiveQuery(() => db.ownForces.toArray(), []);

  const workTypeOptions = useMemo(() => {
    if (!dbWorkTypes) return [];
    return dbWorkTypes.map((wt) => wt.name);
  }, [dbWorkTypes]);

  // Project options for FilterableSelect
  const projectOptions = useMemo(() => {
    if (!projects) return [];
    return projects.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  }, [projects]);

  // Work type options for FilterableMultiSelect
  const workTypeSelectOptions = useMemo(() => {
    return workTypeOptions.map((wt) => ({ value: wt, label: wt }));
  }, [workTypeOptions]);

  // Contractor options for FilterableSelect
  const contractorOptions = useMemo(() => {
    if (!contractors) return [];
    return contractors.map((c) => ({ value: c.name, label: c.name }));
  }, [contractors]);

  // Own forces options for FilterableSelect
  const ownForcesOptions = useMemo(() => {
    if (!ownForcesList) return [];
    return ownForcesList.map((o) => ({ value: o.name, label: o.name }));
  }, [ownForcesList]);

  const scopeProfileId = user?.userId ?? "";

  const handleCreateWorkType = useCallback(async (name: string) => {
    await createLocalDictionaryItem("workTypes", name, scopeProfileId);
  }, [scopeProfileId]);

  const handleCreateContractor = useCallback(async (name: string) => {
    await createLocalDictionaryItem("contractors", name, scopeProfileId);
  }, [scopeProfileId]);

  const handleCreateOwnForce = useCallback(async (name: string) => {
    await createLocalDictionaryItem("ownForces", name, scopeProfileId);
  }, [scopeProfileId]);

  // Autosave draft
  const draftData = useMemo(() => {
    if (!user) return null;
    return {
      projectId: projectId.trim(),
      dateTime: new Date(dateTime),
      workTypes,
      contractor: contractor.trim(),
      ownForces: ownForces.trim(),
      description: description.trim(),
      userId: user.userId,
      scopeProfileId: user.userId,
    };
  }, [projectId, dateTime, workTypes, contractor, ownForces, description, user]);

  const { lastSavedAt } = useAutosave(clientId, draftData);

  // Photo handling
  const handleAddPhotos = useCallback(
    async (files: File[]) => {
      setIsProcessing(true);
      setError("");

      try {
        const remaining = MAX_PHOTOS_PER_REPORT - photos.length;
        if (remaining <= 0) {
          setError(`Максимум ${MAX_PHOTOS_PER_REPORT} фото на отчёт`);
          return;
        }

        const filesToProcess = files.slice(0, remaining);
        if (filesToProcess.length < files.length) {
          showToast(`Добавлено только ${filesToProcess.length} из ${files.length} (лимит ${MAX_PHOTOS_PER_REPORT})`);
        }

        const existingHashes = new Set(photos.map((p) => p.hash).filter(Boolean));
        const dbPhotos = await db.photos
          .where("reportClientId")
          .equals(clientId)
          .toArray();
        for (const p of dbPhotos) {
          if (p.hash) existingHashes.add(p.hash);
        }

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
            errors.push(err instanceof Error ? err.message : `${file.name}: ошибка обработки`);
          }
        }

        if (results.length > 0) {
          setPhotos((prev) => [...prev, ...results]);
        }
        if (errors.length > 0) {
          setError(errors.join("; "));
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [photos, clientId],
  );

  const handleRemovePhoto = useCallback((photoClientId: string) => {
    setPhotos((prev) => prev.filter((p) => p.clientId !== photoClientId));
  }, []);

  // Submit
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!user) {
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

      await db.reports.put({
        clientId,
        projectId: parsed.data.projectId,
        dateTime: parsed.data.dateTime,
        workTypes: parsed.data.workTypes,
        contractor: parsed.data.contractor,
        ownForces: parsed.data.ownForces,
        description: parsed.data.description,
        userId: user.userId,
        scopeProfileId: user.userId,
        syncStatus: "local-only",
        createdAt: (await db.reports.get(clientId))?.createdAt ?? now,
        updatedAt: now,
      });

      await enqueueSyncOp("UPSERT_REPORT", clientId);

      for (const photo of photos) {
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
          scopeProfileId: user.userId,
          createdAt: now,
        });
        await enqueueSyncOp("UPLOAD_PHOTO", photo.clientId);
      }

      // Always enqueue finalization (handles both with and without photos)
      await enqueueSyncOp("FINALIZE_REPORT", clientId);

      showToast("Сохранено на устройстве");
      setTimeout(() => navigate("/reports"), 800);
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

  return (
    <div className="px-4 py-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">Новый отчёт</h2>

      {toast && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          {toast}
        </div>
      )}

      {lastSavedAt && !toast && (
        <div className="mb-3 text-xs text-gray-400">
          Черновик сохранён {lastSavedAt.toLocaleTimeString("ru-RU")}
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
          <FilterableSelect
            options={contractorOptions}
            value={contractor}
            onChange={setContractor}
            onCreateNew={handleCreateContractor}
            placeholder="Выберите или создайте подрядчика"
            required
          />
        </Field>

        <Field label="Собственные силы">
          <FilterableSelect
            options={ownForcesOptions}
            value={ownForces}
            onChange={setOwnForces}
            onCreateNew={handleCreateOwnForce}
            placeholder="Выберите или создайте (необязательно)"
          />
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

        <Field label={`Фото (${photos.length}/${MAX_PHOTOS_PER_REPORT})`}>
          <PhotoCapture
            photos={photos}
            onAdd={handleAddPhotos}
            onRemove={handleRemovePhoto}
            isProcessing={isProcessing}
            disabled={photos.length >= MAX_PHOTOS_PER_REPORT}
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
          {submitting ? "Сохранение..." : "Сохранить отчёт"}
        </button>
      </form>

      {/* Inline utility styles for form fields */}
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
