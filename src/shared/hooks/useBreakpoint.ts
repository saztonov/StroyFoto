import { Grid } from 'antd'

/**
 * Возвращает true, если viewport ≥ md (768px) — считаем это границей «десктоп/планшет».
 * На первом рендере (SSR/гидрация) Grid.useBreakpoint возвращает все false,
 * поэтому дополнительно считываем window.innerWidth для стабильного первого значения.
 */
export function useIsDesktop(): boolean {
  const screens = Grid.useBreakpoint()
  const hasScreens = Object.values(screens).some(Boolean)
  if (hasScreens) return Boolean(screens.md)
  if (typeof window === 'undefined') return true
  return window.innerWidth >= 768
}
