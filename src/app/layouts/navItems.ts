import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
  CloudSyncOutlined,
  FileImageOutlined,
  ProfileOutlined,
  ScheduleOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { createElement } from 'react'
import { nav } from '@/shared/i18n/ru'

export interface NavItem {
  key: string
  label: string
  path: string
  icon: ReactNode
}

export const primaryNav: NavItem[] = [
  { key: 'reports', label: nav.reports, path: '/reports', icon: createElement(FileImageOutlined) },
  { key: 'plans', label: nav.plans, path: '/plans', icon: createElement(ProfileOutlined) },
  { key: 'settings', label: nav.settings, path: '/settings', icon: createElement(SettingOutlined) },
]

export const adminNav: NavItem[] = [
  { key: 'admin-users', label: nav.adminUsers, path: '/admin/users', icon: createElement(UserOutlined) },
  { key: 'admin-projects', label: nav.adminProjects, path: '/admin/projects', icon: createElement(AppstoreOutlined) },
  { key: 'admin-work-types', label: nav.adminWorkTypes, path: '/admin/work-types', icon: createElement(ToolOutlined) },
  { key: 'admin-work-assignments', label: nav.adminWorkAssignments, path: '/admin/work-assignments', icon: createElement(ScheduleOutlined) },
  { key: 'admin-performers', label: nav.adminPerformers, path: '/admin/performers', icon: createElement(TeamOutlined) },
  { key: 'admin-storage-migration', label: nav.adminStorageMigration, path: '/admin/storage-migration', icon: createElement(CloudSyncOutlined) },
]

/** Находит ключ активного пункта меню по текущему pathname. */
export function findActiveKey(pathname: string): string | undefined {
  const all = [...primaryNav, ...adminNav]
  // Сначала ищем точное совпадение, потом — по префиксу (длиннее = точнее).
  const sorted = [...all].sort((a, b) => b.path.length - a.path.length)
  return sorted.find((i) => pathname === i.path || pathname.startsWith(i.path + '/'))?.key
}
