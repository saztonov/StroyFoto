import { useEffect, useState } from 'react'
import { App, Button, List, Select, Space, Typography, Upload } from 'antd'
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
  const isAdmin = profile?.role === 'admin'
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

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

  async function handleUpload(file: UploadFile) {
    if (!projectId) {
      message.warning('Выберите проект перед загрузкой PDF.')
      return false
    }
    const realFile = file as unknown as File
    setUploading(true)
    try {
      await uploadPlanPdf(realFile, projectId, realFile.name.replace(/\.pdf$/i, ''), null)
      message.success('План загружен')
      await reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
    return false // не отдавать антд встроенному uploader-у
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

        {isAdmin && (
          <Upload.Dragger
            name="file"
            multiple={false}
            accept="application/pdf"
            showUploadList={false}
            disabled={uploading || !projectId}
            beforeUpload={(f) => {
              void handleUpload(f as unknown as UploadFile)
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
              <List.Item.Meta title={plan.name} description={plan.r2_key} />
            </List.Item>
          )}
        />
      </Space>
    </>
  )
}
