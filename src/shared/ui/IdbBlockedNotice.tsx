import { useEffect } from 'react'
import { App } from 'antd'

/**
 * Слушает кастомное событие 'stroyfoto:idb-blocked' и показывает
 * предупреждение через Ant Design notification. Монтируется в App.
 */
export function IdbBlockedNotice() {
  const { notification } = App.useApp()

  useEffect(() => {
    const handler = () => {
      notification.warning({
        message: 'Обновление базы данных',
        description:
          'Обновление локальной базы данных заблокировано другой вкладкой. ' +
          'Пожалуйста, закройте другие вкладки приложения и обновите страницу.',
        duration: 0,
      })
    }
    window.addEventListener('stroyfoto:idb-blocked', handler)
    return () => window.removeEventListener('stroyfoto:idb-blocked', handler)
  }, [notification])

  return null
}
