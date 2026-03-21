import { useState, useMemo, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { WORK_TYPES, createReportSchema, MAX_PHOTOS_PER_REPORT } from "@stroyfoto/shared";
import { db } from "../db/dexie";
import { enqueueSyncOp } from "../db/sync-queue";
import { useAuth } from "../auth/auth-context";
import { useAutosave } from "../hooks/use-autosave";
import { PhotoCapture, type ProcessedPhoto } from "../components/PhotoCapture";
import { processPhoto } from "../lib/image-processing";

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
  const [mark, setMark] = useState("");
  const [workType, setWorkType] = useState<string>(WORK_TYPES[0]);
  const [area, setArea] = useState("");
  const [contractor, setContractor] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<ProcessedPhoto[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");

  // Reference data from Dexie
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const workTypes = useLiveQuery(() => db.workTypes.toArray(), []);
  const areas = useLiveQuery(() => db.areas.toArray(), []);
  const contractors = useLiveQuery(() => db.contractors.toArray(), []);

  const workTypeOptions = useMemo(() => {
    if (workTypes && workTypes.length > 0) return workTypes.map((wt) => wt.name);
    return [...WORK_TYPES];
  }, [workTypes]);

  // Autosave draft
  const draftData = useMemo(() => {
    if (!user) return null;
    return {
      projectId: projectId.trim(),
      dateTime: new Date(dateTime),
      mark: mark.trim(),
      workType,
      area: area.trim(),
      contractor: contractor.trim(),
      description: description.trim(),
      userId: user.userId,
    };
  }, [projectId, dateTime, mark, workType, area, contractor, description, user]);

  const { lastSavedAt } = useAutosave(clientId, draftData);

  // Photo handling
  const handleAddPhotos = useCallback(
    async (files: File[]) => {
      setIsProcessing(true);
      setError("");

      try {
        // Calculate remaining slots
        const remaining = MAX_PHOTOS_PER_REPORT - photos.length;
        if (remaining <= 0) {
          setError(`Максимум ${MAX_PHOTOS_PER_REPORT} фото на отчёт`);
          return;
        }

        const filesToProcess = files.slice(0, remaining);
        if (filesToProcess.length < files.length) {
          showToast(`Добавлено только ${filesToProcess.length} из ${files.length} (лимит ${MAX_PHOTOS_PER_REPORT})`);
        }

        // Collect existing hashes for dedup
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

            // Hash deduplication
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
      mark: mark.trim(),
      workType,
      area: area.trim(),
      contractor: contractor.trim(),
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

      // Update or create the report (may exist as draft from autosave)
      await db.reports.put({
        clientId,
        projectId: parsed.data.projectId,
        dateTime: parsed.data.dateTime,
        mark: parsed.data.mark,
        workType: parsed.data.workType,
        area: parsed.data.area,
        contractor: parsed.data.contractor,
        description: parsed.data.description,
        userId: user.userId,
        syncStatus: "local-only",
        createdAt: (await db.reports.get(clientId))?.createdAt ?? now,
        updatedAt: now,
      });

      // Enqueue report sync FIRST (must be synced before photos)
      await enqueueSyncOp("UPSERT_REPORT", clientId);

      // Save photos and enqueue uploads
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
          createdAt: now,
        });
        await enqueueSyncOp("UPLOAD_PHOTO", photo.clientId);
      }

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
          {projects && projects.length > 0 ? (
            <select
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="input-field"
            >
              <option value="">Выберите проект</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
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

        <Field label="Марка / Оси" required>
          <input
            type="text"
            required
            value={mark}
            onChange={(e) => setMark(e.target.value)}
            placeholder="Например: А-Б / 1-3"
            className="input-field"
          />
        </Field>

        <Field label="Вид работ" required>
          <select
            required
            value={workType}
            onChange={(e) => setWorkType(e.target.value)}
            className="input-field"
          >
            {workTypeOptions.map((wt) => (
              <option key={wt} value={wt}>
                {wt}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Участок" required>
          {areas && areas.length > 0 ? (
            <select
              required
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="input-field"
            >
              <option value="">Выберите участок</option>
              {areas.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              required
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Название участка"
              className="input-field"
            />
          )}
        </Field>

        <Field label="Подрядчик" required>
          {contractors && contractors.length > 0 ? (
            <select
              required
              value={contractor}
              onChange={(e) => setContractor(e.target.value)}
              className="input-field"
            >
              <option value="">Выберите подрядчика</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
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
