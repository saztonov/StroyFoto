import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../../api/client";
import { DictionaryFormModal, type FormField } from "./DictionaryFormModal";

interface Column {
  key: string;
  label: string;
  render?: (value: unknown, item: Record<string, unknown>) => React.ReactNode;
}

interface DictionaryManagerProps {
  type: "projects" | "workTypes" | "contractors" | "areas";
  title: string;
  columns: Column[];
  formFields: FormField[];
}

export function DictionaryManager({ type, title, columns, formFields }: DictionaryManagerProps) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: "create" | "edit"; item?: Record<string, unknown> } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const data = await apiFetch<Record<string, unknown>[]>(`/api/admin/dictionaries/${type}`);
      setItems(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSave(values: Record<string, string | boolean | null>) {
    if (modal?.mode === "edit" && modal.item) {
      await apiFetch(`/api/admin/dictionaries/${type}/${modal.item.id}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
    } else {
      await apiFetch(`/api/admin/dictionaries/${type}`, {
        method: "POST",
        body: JSON.stringify(values),
      });
    }
    await loadData();
  }

  async function handleDelete(id: string) {
    if (!confirm("Деактивировать эту запись?")) return;
    await apiFetch(`/api/admin/dictionaries/${type}/${id}`, { method: "DELETE" });
    await loadData();
  }

  async function handleRestore(id: string) {
    await apiFetch(`/api/admin/dictionaries/${type}/${id}`, {
      method: "PUT",
      body: JSON.stringify({ isActive: true }),
    });
    await loadData();
  }

  if (loading) {
    return <div className="py-8 text-center text-gray-500">Загрузка...</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <button
          onClick={() => setModal({ mode: "create" })}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          + Добавить
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {col.label}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Статус
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Действия
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-sm text-gray-500">
                  Нет записей
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id as string} className={!(item.isActive as boolean) ? "bg-gray-50 opacity-60" : ""}>
                  {columns.map((col) => (
                    <td key={col.key} className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {col.render ? col.render(item[col.key], item) : String(item[col.key] ?? "")}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {item.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Активен
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        Неактивен
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    <button
                      onClick={() => setModal({ mode: "edit", item })}
                      className="mr-2 text-blue-600 hover:text-blue-800"
                    >
                      Изменить
                    </button>
                    {item.isActive ? (
                      <button
                        onClick={() => handleDelete(item.id as string)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Удалить
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRestore(item.id as string)}
                        className="text-green-600 hover:text-green-800"
                      >
                        Восстановить
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <DictionaryFormModal
          title={modal.mode === "create" ? `Добавить — ${title}` : `Изменить — ${title}`}
          fields={formFields}
          initialValues={modal.mode === "edit" ? modal.item as Record<string, string | boolean | null> : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
