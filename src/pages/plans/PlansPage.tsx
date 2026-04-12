import { useEffect, useState } from 'react'
import { App, Button, Form, Input, List, Modal, Select, Space, Typography, Upload } from 'antd'
import { InboxOutlined, DownloadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import { PageHeader } from '@/shared/ui/PageHeader'
import { nav } from '@/shared/i18n/ru'
import { useAuth } from '@/app/providers/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  downloadPlanPdf,
  listAllVisiblePlans,
  listPlansForProject,
  planDisplayName,
  uploadPlanPdf,
  type PlanRecord,
} from '@/services/plans'

interface ProjectOption {
  id: string
  name: string
}

export function PlansPage() {
  const { message } = App.useApp()
  const { profile } = useAuth()
  const canUpload = profile?.is_active
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<{ floor: string; name: string }>()

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .order('name')
      if (error) {
        message.error(error.message)
        return
      }
      setProjects((data ?? []) as ProjectOption[])
    })()
  }, [])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function reload() {
    setLoading(true)
    try {
      const list = projectId
        ? await listPlansForProject(projectId)
        : await listAllVisiblePlans()
      setPlans(list)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  function handleFileSelected(file: UploadFile) {
    if (!projectId) {
      message.warning('Выберите проект перед загрузкой PDF.')
      return false
    }
    const realFile = file as unknown as File
    setPendingFile(realFile)
    form.setFieldsValue({
      name: realFile.name.replace(/\.pdf$/i, ''),
      floor: '',
    })
    setModalOpen(true)
    return false
  }

  async function handleModalOk() {
    if (!pendingFile || !projectId) return
    try {
      const values = await form.validateFields()
      setModalOpen(false)
      setUploading(true)
      await uploadPlanPdf(pendingFile, projectId, values.name, values.floor || null, null)
      message.success('План загружен')
      setPendingFile(null)
      await reload()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return // validation
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  function handleModalCancel() {
    setModalOpen(false)
    setPendingFile(null)
  }

  async function handleOpen(plan: PlanRecord) {
    try {
      const blob = await downloadPlanPdf(plan)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // url освободится при выгрузке вкладки
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <PageHeader title={nav.plans} subtitle="PDF-планы по проектам" />
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Select
          allowClear
          placeholder="Все доступные проекты"
          style={{ maxWidth: 360, width: '100%' }}
          value={projectId ?? undefined}
          onChange={(v) => setProjectId(v ?? null)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />

        {canUpload && (
          <Upload.Dragger
            name="file"
            multiple={false}
            accept="application/pdf"
            showUploadList={false}
            disabled={uploading || !projectId}
            beforeUpload={(f) => {
              handleFileSelected(f as unknown as UploadFile)
              return false
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              {projectId
                ? 'Перетащите PDF-план сюда или нажмите для выбора'
                : 'Сначала выберите проект'}
            </p>
            <Typography.Text type="secondary">
              Файл загрузится в приватный R2 через доверенный signer
            </Typography.Text>
          </Upload.Dragger>
        )}

        <List
          loading={loading}
          dataSource={plans}
          locale={{ emptyText: 'Планов пока нет' }}
          renderItem={(plan) => (
            <List.Item
              actions={[
                <Button
                  key="open"
                  type="link"
                  icon={<DownloadOutlined />}
                  onClick={() => handleOpen(plan)}
                >
                  Открыть
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={planDisplayName(plan)}
                description={new Date(plan.created_at).toLocaleDateString('ru-RU')}
              />
            </List.Item>
          )}
        />
      </Space>

      <Modal
        title="Загрузка плана"
        open={modalOpen}
        onOk={handleModalOk}
        onCancel={handleModalCancel}
        okText="Загрузить"
        cancelText="Отмена"
        confirmLoading={uploading}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="floor"
            label="Этаж"
            rules={[{ required: true, message: 'Укажите этаж' }]}
          >
            <Input placeholder="Например: 1, -1, Кровля, Подвал" />
          </Form.Item>
          <Form.Item
            name="name"
            label="Название плана"
            rules={[{ required: true, message: 'Укажите название' }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
