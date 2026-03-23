import { useState, useEffect, type FormEvent } from "react";

export interface FormField {
  key: string;
  label: string;
  type: "text" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  nullable?: boolean;
}

interface DictionaryFormModalProps {
  title: string;
  fields: FormField[];
  initialValues?: Record<string, string | boolean | null>;
  onSave: (values: Record<string, string | boolean | null>) => Promise<void>;
  onClose: () => void;
}

export function DictionaryFormModal({ title, fields, initialValues, onSave, onClose }: DictionaryFormModalProps) {
  const [values, setValues] = useState<Record<string, string | boolean | null>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initial: Record<string, string | boolean | null> = {};
    for (const field of fields) {
      initial[field.key] = initialValues?.[field.key] ?? "";
    }
    setValues(initial);
  }, [fields, initialValues]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      await onSave(values);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function handleFieldChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="mx-4 w-full max-w-md rounded-xl bg-white dark:bg-gray-800 p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{field.label}</label>
              {field.type === "select" ? (
                <select
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2.5 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {field.nullable && <option value="">— Не выбрано —</option>}
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required={field.required !== false}
                  value={(values[field.key] as string) ?? ""}
                  onChange={(e) => handleFieldChange(field.key, e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2.5 text-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              )}
            </div>
          ))}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 transition hover:bg-gray-50 dark:hover:bg-gray-700"
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
