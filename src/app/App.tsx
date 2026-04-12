import { RouterProvider } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { ThemeProvider } from '@/app/providers/ThemeProvider'
import { AuthProvider } from '@/app/providers/AuthProvider'
import { router } from '@/app/router/routes'
import { IdbBlockedNotice } from '@/shared/ui/IdbBlockedNotice'
import { StorageWarningNotice } from '@/shared/ui/StorageWarningNotice'

export default function App() {
  return (
    <ThemeProvider>
      <AntApp>
        <IdbBlockedNotice />
        <StorageWarningNotice />
        <AuthProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </AuthProvider>
      </AntApp>
    </ThemeProvider>
  )
}
