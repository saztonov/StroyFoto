import { useState } from "react";
import { Outlet, NavLink } from "react-router";
import { useOnline } from "../hooks/use-online";
import { useAuth } from "../auth/auth-context";
import { useSync } from "../hooks/use-sync";
import { OfflineBanner } from "./OfflineBanner";
import { InstallBanner } from "./InstallBanner";
import { Sidebar } from "./Sidebar";

export function Layout() {
  const isOnline = useOnline();
  const { user, logout } = useAuth();
  const { pendingCount } = useSync();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-blue-600 px-4 py-3 text-white shadow-md dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1 transition hover:bg-blue-700 dark:hover:bg-gray-700"
            aria-label="Открыть меню"
          >
            <HamburgerIcon className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-bold">СтройФото</h1>
          <span
            className={`h-2.5 w-2.5 rounded-full ${isOnline ? "bg-green-400" : "bg-red-400"}`}
            title={isOnline ? "Онлайн" : "Офлайн"}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm opacity-90">{user?.fullName}</span>
          <button
            onClick={logout}
            className="rounded-md bg-blue-700 px-3 py-1 text-sm transition hover:bg-blue-800 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            Выйти
          </button>
        </div>
      </header>

      <OfflineBanner />
      <InstallBanner />

      {/* Main content */}
      <main className="flex-1 pb-20">
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-gray-200 bg-white py-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)] dark:border-gray-700 dark:bg-gray-800">
        <NavItem to="/reports" label="Отчёты" icon={ReportsIcon} />
        <NavItem to="/reports/new" label="Новый" icon={PlusIcon} />
        <NavItem to="/sync" label="Синхр." icon={SyncIcon} badge={pendingCount > 0 ? pendingCount : undefined} />
      </nav>
    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  badge,
}: {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex flex-col items-center gap-0.5 px-3 py-1 text-xs transition ${
          isActive ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"
        }`
      }
    >
      <Icon className="h-6 w-6" />
      <span>{label}</span>
      {badge !== undefined && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

function ReportsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  );
}

function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}

