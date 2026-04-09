import { useCallback, useEffect, useState } from 'react'

interface AdminResourceState<T> {
  data: T[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useAdminResource<T>(loader: () => Promise<T[]>): AdminResourceState<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loader()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [loader])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
