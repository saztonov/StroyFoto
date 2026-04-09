import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import ruRU from 'antd/locale/ru_RU'

export type ThemeMode = 'light' | 'dark' | 'system'
export type EffectiveTheme = 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  effective: EffectiveTheme
  setMode: (mode: ThemeMode) => void
}

const STORAGE_KEY = 'stroyfoto:theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode())
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemPrefersDark())

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const effective: EffectiveTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  useEffect(() => {
    document.documentElement.dataset.theme = effective
    // Обновляем оба meta theme-color (light/dark), чтобы не было «шва» между splash и app shell.
    const metas = document.querySelectorAll('meta[name="theme-color"]')
    const lightColor = '#ffffff'
    const darkColor = '#141414'
    if (metas.length === 0) {
      const m = document.createElement('meta')
      m.name = 'theme-color'
      m.content = effective === 'dark' ? darkColor : lightColor
      document.head.appendChild(m)
    } else {
      metas.forEach((meta) => {
        const media = meta.getAttribute('media')
        if (media?.includes('dark')) meta.setAttribute('content', darkColor)
        else if (media?.includes('light')) meta.setAttribute('content', lightColor)
        else meta.setAttribute('content', effective === 'dark' ? darkColor : lightColor)
      })
    }
  }, [effective])

  const value = useMemo<ThemeContextValue>(() => ({ mode, setMode, effective }), [mode, setMode, effective])

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        locale={ruRU}
        theme={{
          algorithm: effective === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: {
            colorPrimary: '#1677ff',
            borderRadius: 8,
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useThemeContext must be used inside <ThemeProvider>')
  return ctx
}
