import { App, Button, Collapse, Dropdown, Flex, List, Modal, Spin } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  EyeOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { actions, plansPage } from '@/shared/i18n/ru'
import {
  downloadPlanPdf,
  planDisplayName,
  type PlanRecord,
} from '@/services/plans'
import type { PlanGroup } from '../lib/planGrouping'

interface Props {
  plans: PlanRecord[]
  grouped: PlanGroup[] | null
  loading: boolean
  deletingId: string | null
  replacing: boolean
  replacingPlanId: string | null
  canDelete: (plan: PlanRecord) => boolean
  onPreview: (plan: PlanRecord) => void
  onEdit: (plan: PlanRecord) => void
  onReplace: (plan: PlanRecord) => void
  onDelete: (plan: PlanRecord) => void
}

export function PlanList(props: Props) {
  const { plans, grouped, loading } = props

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 40 }}>
        <Spin />
      </Flex>
    )
  }

  if (grouped) {
    return (
      <Collapse
        defaultActiveKey={grouped.map((g) => g.building)}
        items={grouped.map((group) => ({
          key: group.building,
          label: group.building || plansPage.noBuilding,
          children:
            group.sections.length === 1 && !group.sections[0].section ? (
              <FlatPlanList items={group.sections[0].plans} parent={props} />
            ) : (
              <Collapse
                defaultActiveKey={group.sections.map((s) => s.section)}
                items={group.sections.map((sec) => ({
                  key: sec.section,
                  label: sec.section || plansPage.noSection,
                  children: <FlatPlanList items={sec.plans} parent={props} />,
                }))}
              />
            ),
        }))}
      />
    )
  }

  return <FlatPlanList items={plans} parent={props} />
}

function FlatPlanList({ items, parent }: { items: PlanRecord[]; parent: Props }) {
  return (
    <List
      dataSource={items}
      locale={{ emptyText: 'Планов пока нет' }}
      renderItem={(plan) => <PlanListItem plan={plan} {...parent} />}
    />
  )
}

function PlanListItem({
  plan,
  deletingId,
  replacing,
  replacingPlanId,
  canDelete,
  onPreview,
  onEdit,
  onReplace,
  onDelete,
}: { plan: PlanRecord } & Props) {
  const { message } = App.useApp()

  async function handleOpenTab() {
    try {
      const blob = await downloadPlanPdf(plan)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  const menuItems = [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: actions.edit,
      onClick: () => onEdit(plan),
    },
    {
      key: 'replace',
      icon: <SwapOutlined />,
      label: plansPage.replaceFile,
      onClick: () => onReplace(plan),
    },
    {
      key: 'open',
      icon: <DownloadOutlined />,
      label: 'Открыть в новой вкладке',
      onClick: () => void handleOpenTab(),
    },
    ...(canDelete(plan)
      ? [
          { type: 'divider' as const },
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: actions.delete,
            danger: true,
            onClick: () => {
              Modal.confirm({
                title: plansPage.deleteConfirm,
                content: plansPage.deleteConfirmContent,
                okText: actions.delete,
                cancelText: actions.cancel,
                okButtonProps: { danger: true },
                onOk: () => onDelete(plan),
              })
            },
          },
        ]
      : []),
  ]

  return (
    <List.Item
      actions={[
        <Button
          key="preview"
          type="link"
          icon={<EyeOutlined />}
          onClick={() => onPreview(plan)}
        >
          {plansPage.preview}
        </Button>,
        <Dropdown key="more" menu={{ items: menuItems }} trigger={['click']}>
          <Button
            type="text"
            icon={<EllipsisOutlined />}
            loading={deletingId === plan.id || (replacing && replacingPlanId === plan.id)}
          />
        </Dropdown>,
      ]}
    >
      <List.Item.Meta
        title={planDisplayName(plan)}
        description={new Date(plan.created_at).toLocaleDateString('ru-RU')}
      />
    </List.Item>
  )
}
