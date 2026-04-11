import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  App,
  Button,
  DatePicker,
  Flex,
  Form,
  Input,
  Select,
  Spin,
  Typography,
} from 'antd'
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { v4 as uuid } from 'uuid'
import { PageHeader } from '@/shared/ui/PageHeader'
import { useAuth } from '@/app/providers/AuthProvider'
import {
  loadPerformers,
  loadPlansForProject,
  loadProjectsForUser,
  loadWorkTypes,
  type PlanRow,
} from '@/services/catalogs'
import { saveDraftReport } from '@/services/localReports'
import { triggerSync } from '@/services/sync'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import { PhotoPicker, type DraftPhoto } from './components/PhotoPicker'
import { WorkTypeSelect } from './components/WorkTypeSelect'
import { PerformerSelect } from './components/PerformerSelect'
import { PlanMarkPicker, type PlanMarkValue } from './components/PlanMarkPicker'

interface FormValues {
  projectId: string
  workTypeId: string
  performerId: string
  description?: string
  takenAt: Dayjs
}

export function NewReportPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<FormValues>()

  const [projects, setProjects] = useState<Project[]>([])
  const [workTypes, setWorkTypes] = useState<WorkType[]>([])
  const [performers, setPerformers] = useState<Performer[]>([])
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [photos, setPhotos] = useState<DraftPhoto[]>([])
  const [mark, setMark] = useState<PlanMarkValue | null>(null)
  const [loadingCats, setLoadingCats] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const projectId = Form.useWatch('projectId', form)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [pr, wt, pf] = await Promise.all([
          loadProjectsForUser(),
          loadWorkTypes(),
          loadPerformers(),
        ])
        if (cancelled) return
        setProjects(pr)
        setWorkTypes(wt)
        setPerformers(pf)
      } catch (e) {
        message.error(e instanceof Error ? e.message : 'Не удалось загрузить справочники')
      } finally {
        if (!cancelled) setLoadingCats(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [message])

  useEffect(() => {
    if (!projectId) {
      setPlans([])
      setMark(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await loadPlansForProject(projectId)
        if (!cancelled) setPlans(list)
      } catch {
        if (!cancelled) setPlans([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  )

  const handleCancel = () => {
    if (photos.length > 0) {
      modal.confirm({
        title: 'Отменить создание отчёта?',
        content: 'Добавленные фотографии не будут сохранены.',
        okText: 'Отменить',
        cancelText: 'Продолжить редактирование',
        okButtonProps: { danger: true },
        onOk: () => navigate('/reports'),
      })
      return
    }
    navigate('/reports')
  }

  const onFinish = async (values: FormValues) => {
    if (!profile) return
    if (photos.length === 0) {
      message.warning('Добавьте хотя бы одну фотографию')
      return
    }
    setSubmitting(true)
    try {
      const reportId = uuid()
      await saveDraftReport({
        id: reportId,
        projectId: values.projectId,
        workTypeId: values.workTypeId,
        performerId: values.performerId,
        planId: mark?.planId ?? null,
        description: values.description?.trim() || null,
        takenAt: values.takenAt.toISOString(),
        authorId: profile.id,
        photos: photos.map((p, idx) => ({
          id: p.id,
          blob: p.blob,
          thumbBlob: p.thumbBlob,
          width: p.width,
          height: p.height,
          takenAt: p.takenAt,
          order: idx,
        })),
        mark:
          mark && mark.xNorm != null && mark.yNorm != null
            ? {
                planId: mark.planId,
                page: mark.page,
                xNorm: mark.xNorm,
                yNorm: mark.yNorm,
              }
            : null,
      })
      message.success('Отчёт сохранён локально. Синхронизация в фоне.')
      triggerSync()
      navigate('/reports')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Не удалось сохранить отчёт')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Новый отчёт"
        extra={
          <Button icon={<ArrowLeftOutlined />} onClick={handleCancel}>
            Назад
          </Button>
        }
      />

      {loadingCats ? (
        <Flex align="center" justify="center" style={{ minHeight: 240 }}>
          <Spin />
        </Flex>
      ) : (
        <Form<FormValues>
          form={form}
          layout="vertical"
          size="large"
          onFinish={onFinish}
          initialValues={{ takenAt: dayjs() }}
          style={{ maxWidth: 720 }}
        >
          <Form.Item
            name="projectId"
            label="Проект"
            rules={[{ required: true, message: 'Выберите проект' }]}
          >
            <Select
              showSearch
              placeholder="Выберите проект"
              optionFilterProp="label"
              options={projectOptions}
              notFoundContent={
                <Typography.Text type="secondary">
                  Нет доступных проектов. Обратитесь к администратору.
                </Typography.Text>
              }
            />
          </Form.Item>

          <Form.Item
            name="workTypeId"
            label="Вид работ"
            rules={[{ required: true, message: 'Выберите вид работ' }]}
          >
            <WorkTypeSelect
              options={workTypes}
              onCreated={(wt) => setWorkTypes((prev) => [...prev, wt])}
            />
          </Form.Item>

          <Form.Item
            name="performerId"
            label="Исполнитель"
            rules={[{ required: true, message: 'Выберите исполнителя' }]}
          >
            <PerformerSelect options={performers} />
          </Form.Item>

          <Form.Item name="description" label="Описание (необязательно)">
            <Input.TextArea rows={3} placeholder="Что зафиксировано на фото" maxLength={2000} />
          </Form.Item>

          <Form.Item
            name="takenAt"
            label="Дата и время съёмки"
            rules={[{ required: true, message: 'Укажите дату и время' }]}
          >
            <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="Фотографии" required>
            <PhotoPicker value={photos} onChange={setPhotos} />
          </Form.Item>

          <Form.Item label="План и точка (необязательно)">
            <PlanMarkPicker plans={plans} value={mark} onChange={setMark} />
          </Form.Item>

          <Flex gap={12} wrap="wrap">
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={submitting}
              size="large"
            >
              Сохранить отчёт
            </Button>
            <Button size="large" onClick={handleCancel} disabled={submitting}>
              Отмена
            </Button>
          </Flex>
        </Form>
      )}
    </>
  )
}
