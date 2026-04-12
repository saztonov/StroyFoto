import { useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogoutOutlined } from '@ant-design/icons'
import { Button, Flex, Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import { ThemeToggle } from '@/shared/ui/ThemeToggle'
import { SyncBanner } from '@/shared/ui/SyncBanner'
import { UpdateBanner } from '@/shared/ui/UpdateBanner'
import { useAuth } from '@/app/providers/AuthProvider'
import { appName, actions, nav } from '@/shared/i18n/ru'
import { adminNav, findActiveKey, primaryNav } from '@/app/layouts/navItems'

const { Sider, Header, Content } = Layout

export function DesktopLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, signOut } = useAuth()

  const isAdmin = profile?.role === 'admin'

  const menuItems = useMemo<MenuProps['items']>(() => {
    const base: MenuProps['items'] = primaryNav.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label,
      onClick: () => navigate(item.path),
    }))

    if (isAdmin) {
      base.push({
        key: 'admin',
        label: nav.admin,
        type: 'group',
      })
      base.push(
        ...adminNav.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
          onClick: () => navigate(item.path),
        })),
      )
    }

    return base
  }, [isAdmin, navigate])

  const activeKey = findActiveKey(location.pathname)

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="md"
        width={232}
      >
        <Flex
          align="center"
          justify="center"
          style={{ height: 56, color: '#fff', fontWeight: 600 }}
        >
          {collapsed ? 'СФ' : appName}
        </Flex>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={activeKey ? [activeKey] : []}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            paddingInline: 24,
            background: 'var(--ant-color-bg-container)',
          }}
        >
          <Typography.Text type="secondary" style={{ marginRight: 'auto' }}>
            {profile?.full_name ?? profile?.id ?? ''}
          </Typography.Text>
          <ThemeToggle compact />
          <Button icon={<LogoutOutlined />} onClick={() => void signOut()}>
            {actions.signOut}
          </Button>
        </Header>
        <UpdateBanner />
        <SyncBanner />
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
