import { useMemo, useState, useSyncExternalStore } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogoutOutlined, MenuOutlined } from '@ant-design/icons'
import { Badge, Button, Divider, Drawer, Flex, Layout, Menu, Typography } from 'antd'
import { getSyncSnapshot, subscribeSync } from '@/services/sync'
import type { MenuProps } from 'antd'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { SyncBanner } from '@/shared/ui/SyncBanner'
import { UpdateBanner } from '@/shared/ui/UpdateBanner'
import { useAuth } from '@/app/providers/AuthProvider'
import { actions, appName, nav } from '@/shared/i18n/ru'
import { adminNav, findActiveKey, primaryNav } from '@/app/layouts/navItems'

const { Header, Content } = Layout

export function MobileLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const activeKey = findActiveKey(location.pathname)

  const currentTitle = useMemo(() => {
    const all = [...primaryNav, ...adminNav]
    return all.find((i) => i.key === activeKey)?.label ?? appName
  }, [activeKey])

  const drawerItems = useMemo<MenuProps['items']>(() => {
    const base: MenuProps['items'] = primaryNav.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label,
      onClick: () => {
        setDrawerOpen(false)
        navigate(item.path)
      },
    }))
    if (isAdmin) {
      base.push({ type: 'divider' })
      base.push({ key: 'admin-label', label: nav.admin, type: 'group' })
      base.push(
        ...adminNav.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
          onClick: () => {
            setDrawerOpen(false)
            navigate(item.path)
          },
        })),
      )
    }
    return base
  }, [isAdmin, navigate])

  const tabBarItems = primaryNav

  const syncSnap = useSyncExternalStore(
    (cb) => subscribeSync(cb) as unknown as () => void,
    getSyncSnapshot,
    getSyncSnapshot,
  )
  const pendingTotal = syncSnap.pending + syncSnap.failed

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingInline: 16,
          background: 'var(--ant-color-bg-container)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Button
          type="text"
          icon={<MenuOutlined />}
          aria-label={actions.menu}
          onClick={() => setDrawerOpen(true)}
        />
        <Typography.Title level={5} style={{ margin: 0, flex: 1 }} ellipsis>
          {currentTitle}
        </Typography.Title>
        <ThemeToggle compact />
      </Header>

      <UpdateBanner />
      <SyncBanner />
      <Content style={{ padding: 16, paddingBottom: 80 }}>
        <Outlet />
      </Content>

      {/* Нижняя навигация */}
      <Flex
        align="center"
        justify="space-around"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          height: 64,
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'var(--ant-color-bg-container)',
          borderTop: '1px solid var(--ant-color-border-secondary)',
          zIndex: 20,
        }}
      >
        {tabBarItems.map((item) => {
          const active = activeKey === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                color: active
                  ? 'var(--ant-color-primary)'
                  : 'var(--ant-color-text-secondary)',
                fontSize: 12,
                padding: 8,
              }}
            >
              <span style={{ fontSize: 20 }}>
                {item.key === 'reports' && pendingTotal > 0 ? (
                  <Badge count={pendingTotal} size="small" offset={[2, -2]}>
                    {item.icon}
                  </Badge>
                ) : (
                  item.icon
                )}
              </span>
              <span>{item.label}</span>
            </button>
          )
        })}
      </Flex>

      <Drawer
        title={appName}
        placement="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={280}
      >
        <Flex vertical gap={12}>
          <Typography.Text type="secondary">
            {profile?.full_name ?? profile?.id ?? ''}
          </Typography.Text>
          <Menu
            mode="inline"
            selectedKeys={activeKey ? [activeKey] : []}
            items={drawerItems}
            style={{ borderInlineEnd: 'none' }}
          />
          <Divider style={{ margin: '8px 0' }} />
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              setDrawerOpen(false)
              void signOut()
            }}
            block
          >
            {actions.signOut}
          </Button>
        </Flex>
      </Drawer>
    </Layout>
  )
}
