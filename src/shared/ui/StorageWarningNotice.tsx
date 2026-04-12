import { useEffect } from 'react'
import { App } from 'antd'

/**
 * Слушает событие 'stroyfoto:storage-warning' и показывает предупреждение
 * о заполненности хранилища.
 */
export function StorageWarningNotice() {
  const { notification } = App.useApp()

  useEffect(() => {
    const handler = (e: Event) => {
      const percent = (e as CustomEvent).detail?.percent ?? '?'
      notification.warning({
        message: 'Хранилище заполняется',
        description: `Локальное хранилище заполнено на ${percent}%. Перейдите в Настройки для очистки кэша.`,
        duration: 10,
        key: 'storage-warning',
      })
    }
    window.addEventListener('stroyfoto:storage-warning', handler)
    return () => window.removeEventListener('stroyfoto:storage-warning', handler)
  }, [notification])

  return null
}
