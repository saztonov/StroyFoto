import { useState, type FormEvent } from "react";
import { apiFetch } from "../../api/client";

interface UserEditModalProps {
  userId: string;
  initialFullName: string;
  initialRole: "ADMIN" | "WORKER";
  initialIsActive: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (data: { fullName: string; role: "ADMIN" | "WORKER"; isActive: boolean }) => void;
}

export function UserEditModal({
  userId,
  initialFullName,
  initialRole,
  initialIsActive,
  isSelf,
  onClose,
  onSaved,
}: UserEditModalProps) {
  const [fullName, setFullName] = useState(initialFullName);
  const [role, setRole] = useState<"ADMIN" | "WORKER">(initialRole);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const body: Record<string, unknown> = { fullName };
      if (!isSelf) {
        body.role = role;
        body.isActive = isActive;
      }
      await apiFetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      onSaved({ fullName, role: isSelf ? initialRole : role, isActive: isSelf ? initialIsActive : isActive });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Редактировать пользователя</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Имя</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Роль</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "ADMIN" | "WORKER")}
              disabled={isSelf}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
            >
              <option value="WORKER">Работник</option>
              <option value="ADMIN">Админ</option>
            </select>
            {isSelf && (
              <p className="mt-1 text-xs text-gray-400">Нельзя изменить свою роль</p>
            )}
          </div>

          {!isSelf && (
            <div className="flex items-center gap-3">
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-blue-600 peer-checked:after:translate-x-full" />
              </label>
              <span className="text-sm text-gray-700">
                {isActive ? "Активен" : "Заблокирован"}
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
