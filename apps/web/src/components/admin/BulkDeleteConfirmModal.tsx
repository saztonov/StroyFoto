import { useState } from "react";
import { apiFetch } from "../../api/client";

interface BulkDeleteConfirmModalProps {
  mode: "all" | "project";
  projectName?: string;
  projectId?: string;
  onClose: () => void;
  onDeleted: (result: { reports: number; photos: number }) => void;
}

export function BulkDeleteConfirmModal({
  mode,
  projectName,
  projectId,
  onClose,
  onDeleted,
}: BulkDeleteConfirmModalProps) {
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const expectedValue = mode === "all" ? "УДАЛИТЬ" : (projectName ?? "");
  const isConfirmed = confirmation === expectedValue;

  async function handleDelete() {
    if (!isConfirmed) return;
    setError("");
    setDeleting(true);

    try {
      const body: Record<string, unknown> = {};
      if (mode === "project" && projectId) {
        body.projectId = projectId;
      }

      const result = await apiFetch<{ deleted: { reports: number; photos: number } }>(
        "/api/admin/reports/bulk",
        {
          method: "DELETE",
          body: JSON.stringify(body),
        },
      );
      onDeleted(result.deleted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-red-600 dark:text-red-400">
          {mode === "all" ? "Удалить все отчёты" : `Удалить отчёты проекта`}
        </h3>

        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <p className="font-medium">Это действие необратимо!</p>
          <p className="mt-1">
            {mode === "all"
              ? "Будут удалены все отчёты и фотографии из системы."
              : `Будут удалены все отчёты и фотографии проекта «${projectName}».`}
          </p>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
            {mode === "all"
              ? 'Введите «УДАЛИТЬ» для подтверждения'
              : `Введите название проекта «${projectName}» для подтверждения`}
          </label>
          <input
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            disabled={deleting}
            placeholder={expectedValue}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2.5 text-sm transition focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 transition hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!isConfirmed || deleting}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? "Удаление..." : "Удалить"}
          </button>
        </div>
      </div>
    </div>
  );
}
