import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import type { User } from "@stroyfoto/shared";

interface ProjectItem {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

interface UserProjectsModalProps {
  user: User & { assignedProjectIds: string[] };
  onClose: () => void;
  onSaved: (projectIds: string[]) => void;
}

export function UserProjectsModal({ user, onClose, onSaved }: UserProjectsModalProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(user.assignedProjectIds));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<ProjectItem[]>("/api/admin/dictionaries/projects")
      .then((data) => {
        setProjects(data.filter((p) => p.isActive));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Ошибка загрузки проектов");
      })
      .finally(() => setLoading(false));
  }, []);

  function toggleProject(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const projectIds = Array.from(selectedIds);
      await apiFetch(`/api/admin/users/${user.id}/projects`, {
        method: "PUT",
        body: JSON.stringify({ projectIds }),
      });
      onSaved(projectIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-gray-800 shadow-xl">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Проекты: {user.fullName}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{user.email}</p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
          ) : projects.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">Нет активных проектов</p>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <label
                  key={project.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(project.id)}
                    onChange={() => toggleProject(project.id)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{project.name}</span>
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">({project.code})</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition disabled:opacity-50"
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
