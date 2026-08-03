import { Card, Descriptions, Space, Tag } from 'antd'
import dayjs from 'dayjs'
import { reportDetails } from '@/shared/i18n/ru'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import type { LoadedReport } from '../types'
import { resolveCatalogName, resolvePerformerLabels } from '../lib/catalogNames'

interface Props {
  data: LoadedReport
  projects: Project[]
  workTypes: WorkType[]
  performers: Performer[]
  workAssignments: WorkAssignment[]
  status: { text: string; color: string }
}

export function ReportMetaCard({ data, projects, workTypes, performers, workAssignments, status }: Props) {
  const projectName = projects.find((p) => p.id === data.card.projectId)?.name ?? '—'
  const performerLabels = resolvePerformerLabels(
    data.card,
    (id) => performers.find((p) => p.id === id),
    {
      contractor: reportDetails.performerContractor,
      own: reportDetails.performerOwn,
    },
  )
  const workTypeName =
    resolveCatalogName(
      data.card.workTypeName,
      data.card.workTypeId,
      (id) => workTypes.find((w) => w.id === id)?.name,
    ) ?? '—'
  const workAssignmentName =
    resolveCatalogName(
      data.card.workAssignmentName,
      data.card.workAssignmentId,
      (id) => workAssignments.find((w) => w.id === id)?.name,
    ) ?? '—'

  return (
    <Card title={reportDetails.sectionMeta}>
      <Descriptions column={1} size="small">
        <Descriptions.Item label={reportDetails.project}>{projectName}</Descriptions.Item>
        <Descriptions.Item label={reportDetails.workType}>{workTypeName}</Descriptions.Item>
        <Descriptions.Item label={reportDetails.workAssignment}>
          {workAssignmentName}
        </Descriptions.Item>
        <Descriptions.Item
          label={
            performerLabels.length > 1
              ? reportDetails.performers
              : reportDetails.performer
          }
        >
          {performerLabels.length > 0 ? performerLabels.join(', ') : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={reportDetails.description}>
          {data.card.description || '—'}
        </Descriptions.Item>
        <Descriptions.Item label={reportDetails.takenAt}>
          {data.card.takenAt
            ? dayjs(data.card.takenAt).format('DD.MM.YYYY HH:mm')
            : '—'}
        </Descriptions.Item>
        <Descriptions.Item label={reportDetails.createdAt}>
          {dayjs(data.card.createdAt).format('DD.MM.YYYY HH:mm')}
        </Descriptions.Item>
        <Descriptions.Item label={reportDetails.author}>
          {data.authorName ?? data.card.authorId}
        </Descriptions.Item>
        <Descriptions.Item label={reportDetails.syncStatus}>
          <Space size={4} wrap>
            <Tag color={status.color}>{status.text}</Tag>
            {data.card.remoteOnly && <Tag color="default">С сервера</Tag>}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  )
}
