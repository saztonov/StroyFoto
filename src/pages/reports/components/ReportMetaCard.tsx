import { Card, Descriptions, Space, Tag } from 'antd'
import dayjs from 'dayjs'
import { reportDetails } from '@/shared/i18n/ru'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import type { LoadedReport } from '../types'

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
  const workTypeName = workTypes.find((w) => w.id === data.card.workTypeId)?.name ?? '—'
  const performer = performers.find((p) => p.id === data.card.performerId)
  const workAssignmentName = data.card.workAssignmentId
    ? workAssignments.find((w) => w.id === data.card.workAssignmentId)?.name ?? '—'
    : '—'

  return (
    <Card title={reportDetails.sectionMeta}>
      <Descriptions column={1} size="small">
        <Descriptions.Item label={reportDetails.project}>{projectName}</Descriptions.Item>
        <Descriptions.Item label={reportDetails.workType}>{workTypeName}</Descriptions.Item>
        <Descriptions.Item label={reportDetails.workAssignment}>
          {workAssignmentName}
        </Descriptions.Item>
        <Descriptions.Item label={reportDetails.performer}>
          {performer
            ? `${performer.name} · ${
                performer.kind === 'contractor'
                  ? reportDetails.performerContractor
                  : reportDetails.performerOwn
              }`
            : '—'}
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
