import { useEffect, useState } from "react";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../hooks/use-online";
import { apiFetch } from "../api/client";
import type { User } from "@stroyfoto/shared";
import { DictionaryManager } from "../components/admin/DictionaryManager";
import type { FormField } from "../components/admin/DictionaryFormModal";
import { UserProjectsModal } from "../components/admin/UserProjectsModal";
import { UserEditModal } from "../components/admin/UserEditModal";

interface AdminUser extends User {
  assignedProjectIds: string[];
}

interface AdminStats {
  totalReports: number;
  totalPhotos: number;
  reportsByProject: { projectId: string; projectName?: string; projectCode?: string; count: number }[];
}

type TabKey = "overview" | "users" | "projects" | "workTypes" | "contractors" | "ownForces";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "users", label: "Пользователи" },
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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [projectsModalUser, setProjectsModalUser] = useState<AdminUser | null>(null);
  const [editModalUser, setEditModalUser] = useState<AdminUser | null>(null);

  const loadData = () => {
    if (user?.role !== "ADMIN" || !isOnline) return;

    setLoading(true);
    setError("");

    Promise.all([
      apiFetch<AdminUser[]>("/api/admin/users"),
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
  };

  useEffect(() => {
    loadData();
  }, [user?.role, isOnline]);

  if (user?.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-20">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
          <svg className="h-8 w-8 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Доступ запрещён</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Эта страница доступна только администраторам.
        </p>
      </div>
    );
  }

  if (!isOnline) {
    return (
      <div className="px-4 py-20 text-center">
        <p className="text-gray-500 dark:text-gray-400">
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
        <div className="rounded-lg bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">Администрирование</h2>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
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
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
                <p className="text-sm text-gray-500 dark:text-gray-400">Всего отчётов</p>
                <p className="mt-1 text-2xl font-bold text-blue-600">{stats.totalReports}</p>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm">
                <p className="text-sm text-gray-500 dark:text-gray-400">Всего фото</p>
                <p className="mt-1 text-2xl font-bold text-purple-600">{stats.totalPhotos}</p>
              </div>
            </div>
          )}

          {/* Reports by project */}
          {stats && stats.reportsByProject.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Отчёты по проектам</h3>
              <div className="space-y-2">
                {stats.reportsByProject.map((item) => (
                  <div
                    key={item.projectId}
                    className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3"
                  >
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {item.projectName ?? item.projectId}
                    </span>
                    <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:text-blue-300">
                      {item.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "users" && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
            Пользователи ({users.length})
          </h3>

          {users.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Имя</th>
                      <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Email</th>
                      <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Роль</th>
                      <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Статус</th>
                      <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Проекты</th>
                      <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {users.map((u) => (
                      <tr key={u.id} className={!u.isActive ? "bg-gray-50 dark:bg-gray-900 opacity-60" : ""}>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                          {u.fullName}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-300">
                          {u.email}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.role === "ADMIN"
                              ? u.id === user?.userId ? "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300" : "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                          }`}>
                            {u.role === "ADMIN" ? (u.id === user?.userId ? "Админ (вы)" : "Админ") : "Работник"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {u.isActive ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                              Активен
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-900/40 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                              Заблокирован
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <button
                            onClick={() => setProjectsModalUser(u)}
                            className="rounded-lg bg-blue-50 dark:bg-blue-900/30 px-3 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition"
                          >
                            {u.assignedProjectIds.length > 0
                              ? `${u.assignedProjectIds.length} проект(ов)`
                              : "Назначить"}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <button
                            onClick={() => setEditModalUser(u)}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800"
                          >
                            Изменить
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-gray-400 dark:text-gray-500">Нет данных</p>
          )}
        </div>
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

      {/* User Projects Modal */}
      {projectsModalUser && (
        <UserProjectsModal
          user={projectsModalUser}
          onClose={() => setProjectsModalUser(null)}
          onSaved={(projectIds) => {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === projectsModalUser.id
                  ? { ...u, assignedProjectIds: projectIds }
                  : u,
              ),
            );
            setProjectsModalUser(null);
          }}
        />
      )}

      {/* User Edit Modal */}
      {editModalUser && (
        <UserEditModal
          userId={editModalUser.id}
          initialFullName={editModalUser.fullName}
          initialRole={editModalUser.role}
          initialIsActive={editModalUser.isActive}
          isSelf={editModalUser.id === user?.userId}
          onClose={() => setEditModalUser(null)}
          onSaved={({ fullName, role: newRole, isActive }) => {
            setUsers((prev) =>
              prev.map((u) =>
                u.id === editModalUser.id
                  ? { ...u, fullName, role: newRole, isActive }
                  : u,
              ),
            );
            setEditModalUser(null);
          }}
        />
      )}
    </div>
  );
}
