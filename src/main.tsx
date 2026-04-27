import React from 'react'
import ReactDOM from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import App from '@/app/App'
import { applyRetention } from '@/services/retention'
import { setUpdateAvailable, setUpdateSW } from '@/services/appUpdate'

dayjs.locale('ru')

// При старте применяем выбранную пользователем политику локального хранения.
// Удаляет только synced-записи и пропускает отчёты с pending_upload фото,
// поэтому несинхронизированные данные остаются нетронутыми.
queueMicrotask(() => {
  void applyRetention().catch(() => undefined)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Регистрация service worker для PWA. SW отвечает только за статические
// ассеты + Background Sync wake-up — бизнес-данные синхронизируются нашим
// собственным циклом в src/services/sync.ts.
// Периодически проверяем наличие новой версии: каждые 5 минут, при фокусе
// вкладки и при выходе в онлайн.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateAvailable()
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return

        setInterval(() => {
          if (!document.hidden) void registration.update()
        }, 5 * 60 * 1000)

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void registration.update()
        })

        window.addEventListener('online', () => {
          void registration.update()
        })
      },
    })

    setUpdateSW(updateSW)
  })
}
