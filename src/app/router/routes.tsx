import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RequireActive, RequireAdmin, RequireAuth, RequireGuest } from '@/app/router/guards'
import { AppShell } from '@/app/layouts/AppShell'
import { AuthLayout } from '@/app/layouts/AuthLayout'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'
import { PendingActivationPage } from '@/pages/auth/PendingActivationPage'

import { ReportsListPage } from '@/pages/reports/ReportsListPage'
import { NewReportPage } from '@/pages/reports/NewReportPage'
import { ReportDetailsPage } from '@/pages/reports/ReportDetailsPage'
import { PlansPage } from '@/pages/plans/PlansPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'

import { UsersPage } from '@/pages/admin/UsersPage'
import { ProjectsPage } from '@/pages/admin/ProjectsPage'
import { WorkTypesPage } from '@/pages/admin/WorkTypesPage'
import { PerformersPage } from '@/pages/admin/PerformersPage'

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
              { path: '/reports/new', element: <NewReportPage /> },
              { path: '/reports/:id', element: <ReportDetailsPage /> },
              { path: '/plans', element: <PlansPage /> },
              { path: '/settings', element: <SettingsPage /> },

              // Админская ветка — дополнительная проверка роли
              {
                element: <RequireAdmin />,
                children: [
                  { path: '/admin/users', element: <UsersPage /> },
                  { path: '/admin/projects', element: <ProjectsPage /> },
                  { path: '/admin/work-types', element: <WorkTypesPage /> },
                  { path: '/admin/performers', element: <PerformersPage /> },
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
