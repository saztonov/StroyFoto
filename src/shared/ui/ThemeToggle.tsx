import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Segmented, Tooltip } from 'antd'
import { useTheme, type ThemeMode } from '@/shared/hooks/useTheme'
import { settings } from '@/shared/i18n/ru'

interface ThemeToggleProps {
  compact?: boolean
}

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { mode, setMode, effective } = useTheme()

  if (compact) {
    // Кнопка-иконка в шапке: просто переключает light <-> dark, игнорируя «system».
    const next: ThemeMode = effective === 'dark' ? 'light' : 'dark'
    const icon = effective === 'dark' ? <SunOutlined /> : <MoonOutlined />
    const label = effective === 'dark' ? settings.themeLight : settings.themeDark
    return (
      <Tooltip title={label}>
        <button
          type="button"
          onClick={() => setMode(next)}
          aria-label={label}
          style={{
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            padding: 8,
            color: 'inherit',
            fontSize: 18,
          }}
        >
          {icon}
        </button>
      </Tooltip>
    )
  }

  return (
    <Segmented<ThemeMode>
      value={mode}
      onChange={(value) => setMode(value)}
      options={[
        { label: settings.themeLight, value: 'light', icon: <SunOutlined /> },
        { label: settings.themeDark, value: 'dark', icon: <MoonOutlined /> },
        { label: settings.themeSystem, value: 'system', icon: <DesktopOutlined /> },
      ]}
    />
  )
}
