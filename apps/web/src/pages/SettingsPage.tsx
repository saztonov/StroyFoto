import { useEffect, useState } from "react";
import { useTheme, type Theme } from "../hooks/use-theme";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../hooks/use-online";
import { apiFetch } from "../api/client";
import { db } from "../db/dexie";

interface ProfileData {
  id: string;
  email: string;
  role: "ADMIN" | "WORKER";
  fullName: string;
  createdAt: string;
  updatedAt: string;
}

interface StatsData {
  reportCount: number;
  photoCount: number;
  projects: { id: string; name: string }[];
}

const themeOptions: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Светлая",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Тёмная",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Системная",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
      </svg>
    ),
  },
];

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user, refreshUser } = useAuth();
  const isOnline = useOnline();

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);

  const [editingName, setEditingName] = useState(user?.fullName ?? "");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isOnline) return;
    setLoading(true);
    Promise.all([
      apiFetch<ProfileData>("/api/profile"),
      apiFetch<StatsData>("/api/profile/stats"),
    ])
      .then(([p, s]) => {
        setProfile(p);
        setStats(s);
        setEditingName(p.fullName);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOnline]);

  async function handleSaveName() {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === (profile?.fullName ?? user?.fullName)) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      const updated = await apiFetch<ProfileData>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ fullName: trimmed }),
      });
      setProfile(updated);
      setEditingName(updated.fullName);
      await db.authSession.update("current", { fullName: updated.fullName });
      await refreshUser();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  const roleName = user?.role === "ADMIN" ? "Администратор" : "Работник";
  const nameChanged = editingName.trim() !== (profile?.fullName ?? user?.fullName ?? "");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">Настройки</h2>

      {/* Account section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Аккаунт
        </h3>
        <div className="space-y-4 rounded-xl bg-gray-100 p-4 dark:bg-gray-800">
          {/* Full name (editable) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">ФИО</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                onClick={handleSaveName}
                disabled={!nameChanged || saving || !isOnline}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {saving ? "..." : saveSuccess ? "\u2713" : "Сохранить"}
              </button>
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Email</label>
            <p className="text-sm text-gray-800 dark:text-gray-200">{user?.email}</p>
          </div>

          {/* Role */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Роль</label>
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                user?.role === "ADMIN"
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                  : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
              }`}
            >
              {roleName}
            </span>
          </div>

          {/* Registration date */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              Дата регистрации
            </label>
            {loading ? (
              <p className="text-sm text-gray-400">Загрузка...</p>
            ) : profile?.createdAt ? (
              <p className="text-sm text-gray-800 dark:text-gray-200">
                {dateFormatter.format(new Date(profile.createdAt))}
              </p>
            ) : (
              <p className="text-sm text-gray-400">{isOnline ? "—" : "Нет подключения"}</p>
            )}
          </div>
        </div>
      </section>

      {/* Projects section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Мои проекты
        </h3>
        <div className="rounded-xl bg-gray-100 p-4 dark:bg-gray-800">
          {loading ? (
            <p className="text-sm text-gray-400">Загрузка...</p>
          ) : !isOnline && !stats ? (
            <p className="text-sm text-gray-400">Нет подключения к серверу</p>
          ) : user?.role === "ADMIN" ? (
            <p className="text-sm text-gray-600 dark:text-gray-300">Все проекты (администратор)</p>
          ) : stats && stats.projects.length > 0 ? (
            <ul className="space-y-1">
              {stats.projects.map((p) => (
                <li key={p.id} className="text-sm text-gray-800 dark:text-gray-200">
                  {p.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">Нет назначенных проектов</p>
          )}
        </div>
      </section>

      {/* Stats section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Статистика
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-100 p-4 text-center dark:bg-gray-800">
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {loading ? "..." : stats ? stats.reportCount : "—"}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Отчётов</p>
          </div>
          <div className="rounded-xl bg-gray-100 p-4 text-center dark:bg-gray-800">
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {loading ? "..." : stats ? stats.photoCount : "—"}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Фотографий</p>
          </div>
        </div>
      </section>

      {/* Theme section */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Тема оформления
        </h3>
        <div className="flex gap-2 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
          {themeOptions.map((opt) => {
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-white text-blue-600 shadow dark:bg-gray-700 dark:text-blue-400"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
