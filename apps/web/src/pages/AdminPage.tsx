import { useEffect, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../hooks/use-online";
import { apiFetch } from "../api/client";
import type { User } from "@stroyfoto/shared";
import { DictionaryManager } from "../components/admin/DictionaryManager";
import type { FormField } from "../components/admin/DictionaryFormModal";

interface AdminStats {
  totalReports: number;
  totalPhotos: number;
  reportsByProject: { projectId: string; projectName?: string; projectCode?: string; count: number }[];
}

type TabKey = "overview" | "projects" | "workTypes" | "contractors" | "ownForces";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "projects", label: "Проекты" },
  { key: "workTypes", label: "Виды работ" },
  { key: "contractors", label: "Подрядчики" },
  { key: "ownForces", label: "Собств. силы" },
];

const projectFormFields: FormField[] = [
  { key: "name", label: "Название", type: "text" },
  { key: "code", label: "Код", type: "text" },
  { key: "address", label: "Адрес", type: "text", required: false },
];

const simpleFormFields: FormField[] = [
  { key: "name", label: "Название", type: "text" },
];

export function AdminPage() {
  const { user } = useAuth();
  const isOnline = useOnline();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (user?.role !== "ADMIN" || !isOnline) return;

    setLoading(true);
    setError("");

    Promise.all([
      apiFetch<User[]>("/api/admin/users"),
      apiFetch<AdminStats>("/api/admin/stats"),
    ])
      .then(([usersData, statsData]) => {
        setUsers(usersData);
        setStats(statsData);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
      })
      .finally(() => setLoading(false));
  }, [user?.role, isOnline]);

  if (user?.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <svg className="h-8 w-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900">Доступ запрещён</h2>
        <p className="mt-1 text-sm text-gray-500">
          Эта страница доступна только администраторам.
        </p>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="px-4 py-20 text-center">
        <p className="text-gray-500">
          Панель администратора доступна только при наличии подключения к сети.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">Администрирование</h2>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <>
          {/* Stats cards */}
          {stats && (
            <div className="mb-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Всего отчётов</p>
                <p className="mt-1 text-2xl font-bold text-blue-600">{stats.totalReports}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Всего фото</p>
                <p className="mt-1 text-2xl font-bold text-purple-600">{stats.totalPhotos}</p>
              </div>
            </div>
          )}

          {/* Reports by project */}
          {stats && stats.reportsByProject.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Отчёты по проектам</h3>
              <div className="space-y-2">
                {stats.reportsByProject.map((item) => (
                  <div
                    key={item.projectId}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
                  >
                    <span className="text-sm font-medium text-gray-700">
                      {item.projectName ?? item.projectId}
                    </span>
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Users table */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              Пользователи ({users.length})
            </h3>

            {users.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-gray-200 bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 font-medium text-gray-500">Имя</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Логин</th>
                        <th className="px-4 py-3 font-medium text-gray-500">Роль</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                            {u.fullName}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                            {u.username}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                u.role === "ADMIN"
                                  ? "bg-orange-100 text-orange-700"
                                  : "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {u.role === "ADMIN" ? "Админ" : "Работник"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400">Нет данных</p>
            )}
          </div>
        </>
      )}

      {activeTab === "projects" && (
        <DictionaryManager
          type="projects"
          title="Проекты"
          columns={[
            { key: "name", label: "Название" },
            { key: "code", label: "Код" },
            { key: "address", label: "Адрес" },
          ]}
          formFields={projectFormFields}
        />
      )}

      {activeTab === "workTypes" && (
        <DictionaryManager
          type="workTypes"
          title="Виды работ"
          columns={[{ key: "name", label: "Название" }]}
          formFields={simpleFormFields}
        />
      )}

      {activeTab === "contractors" && (
        <DictionaryManager
          type="contractors"
          title="Подрядчики"
          columns={[{ key: "name", label: "Название" }]}
          formFields={simpleFormFields}
        />
      )}

      {activeTab === "ownForces" && (
        <DictionaryManager
          type="ownForces"
          title="Собственные силы"
          columns={[{ key: "name", label: "Название" }]}
          formFields={simpleFormFields}
        />
      )}
    </div>
  );
}
