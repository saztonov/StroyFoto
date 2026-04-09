import { RouterProvider } from 'react-router-dom'
import { App as AntApp } from 'antd'
import { ThemeProvider } from '@/app/providers/ThemeProvider'
import { AuthProvider } from '@/app/providers/AuthProvider'
import { router } from '@/app/router/routes'

export default function App() {
  return (
    <ThemeProvider>
      <AntApp>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AntApp>
    </ThemeProvider>
  )
}
