import React from 'react'
import ReactDOM from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import App from '@/app/App'
import { applyRetention } from '@/services/retention'

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
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
  })
}
