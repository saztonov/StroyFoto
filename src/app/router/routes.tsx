import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Skeleton } from 'antd'
import { RequireActive, RequireAdmin, RequireAuth, RequireGuest } from '@/app/router/guards'
import { AppShell } from '@/app/layouts/AppShell'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { PendingActivationPage } from '@/pages/auth/PendingActivationPage'

import { ReportsListPage } from '@/pages/reports/ReportsListPage'

// Тяжёлые страницы — отдельные чанки. Снижает initial bundle и ускоряет первый рендер.
const NewReportPage = lazy(() =>
  import('@/pages/reports/NewReportPage').then((m) => ({ default: m.NewReportPage })),
)
const ReportDetailsPage = lazy(() =>
  import('@/pages/reports/ReportDetailsPage').then((m) => ({ default: m.ReportDetailsPage })),
)
const PlansPage = lazy(() =>
  import('@/pages/plans/PlansPage').then((m) => ({ default: m.PlansPage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const UsersPage = lazy(() =>
  import('@/pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })),
)
const ProjectsPage = lazy(() =>
  import('@/pages/admin/ProjectsPage').then((m) => ({ default: m.ProjectsPage })),
)
const WorkTypesPage = lazy(() =>
  import('@/pages/admin/WorkTypesPage').then((m) => ({ default: m.WorkTypesPage })),
)
const PerformersPage = lazy(() =>
  import('@/pages/admin/PerformersPage').then((m) => ({ default: m.PerformersPage })),
)
const WorkAssignmentsPage = lazy(() =>
  import('@/pages/admin/WorkAssignmentsPage').then((m) => ({ default: m.WorkAssignmentsPage })),
)

function lazyPage(node: ReactNode) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Skeleton active paragraph={{ rows: 6 }} />}>{node}</Suspense>
    </ErrorBoundary>
  )
}

export const router = createBrowserRouter([
  // Гостевые маршруты (если уже вошёл — редирект на /reports)
  {
    element: <RequireGuest />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
    ],
  },

  // Экран ожидания активации — требует auth, но НЕ требует active
  {
    element: <RequireAuth allowInactive />,
    children: [
      {
        element: <AuthLayout />,
        children: [{ path: '/pending-activation', element: <PendingActivationPage /> }],
      },
    ],
  },

  // Основное защищённое дерево: auth + active + app shell
  {
    element: <RequireAuth />,
    children: [
      {
        element: <RequireActive />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <Navigate to="/reports" replace /> },
              { path: '/reports', element: <ReportsListPage /> },
              { path: '/reports/new', element: lazyPage(<NewReportPage />) },
              { path: '/reports/:id', element: lazyPage(<ReportDetailsPage />) },
              { path: '/plans', element: lazyPage(<PlansPage />) },
              { path: '/settings', element: lazyPage(<SettingsPage />) },

              // Админская ветка — дополнительная проверка роли
              {
                element: <RequireAdmin />,
                children: [
                  { path: '/admin/users', element: lazyPage(<UsersPage />) },
                  { path: '/admin/projects', element: lazyPage(<ProjectsPage />) },
                  { path: '/admin/work-types', element: lazyPage(<WorkTypesPage />) },
                  { path: '/admin/work-assignments', element: lazyPage(<WorkAssignmentsPage />) },
                  { path: '/admin/performers', element: lazyPage(<PerformersPage />) },
                ],
              },
            ],
          },
        ],
      },
    ],
  },

  // Любой неизвестный путь — на /reports (защищённый корень сам отправит на /login если надо)
  { path: '*', element: <Navigate to="/reports" replace /> },
])
