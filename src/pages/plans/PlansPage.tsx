import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  App,
  Button,
  Collapse,
  Dropdown,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Typography,
  Upload,
} from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  EyeOutlined,
  InboxOutlined,
  LeftOutlined,
  RightOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import { PageHeader } from '@/shared/ui/PageHeader'
import { actions, nav, plansPage } from '@/shared/i18n/ru'
import { useAuth } from '@/app/providers/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  deletePlan,
  downloadPlanPdf,
  listAllVisiblePlans,
  listPlansForProject,
  planDisplayName,
  replacePlanFile,
  updatePlan,
  uploadPlanPdf,
  type PlanRecord,
} from '@/services/plans'
import { PdfPlanCanvas } from '@/pages/reports/components/PdfPlanCanvas'

interface ProjectOption {
  id: string
  name: string
}

interface UploadFormValues {
  name: string
  floor: string
  building: string
  section: string
}

interface EditFormValues {
  name: string
  floor: string
  building: string
  section: string
}

/** Группировка планов по корпус → секция */
interface PlanGroup {
  building: string
  sections: { section: string; plans: PlanRecord[] }[]
}

function groupPlans(plans: PlanRecord[]): PlanGroup[] | null {
  const hasGrouping = plans.some((p) => p.building || p.section)
  if (!hasGrouping) return null

  const map = new Map<string, Map<string, PlanRecord[]>>()
  for (const p of plans) {
    const b = p.building || ''
    const s = p.section || ''
    if (!map.has(b)) map.set(b, new Map())
    const secMap = map.get(b)!
    if (!secMap.has(s)) secMap.set(s, [])
    secMap.get(s)!.push(p)
  }

  const result: PlanGroup[] = []
  for (const [building, secMap] of map) {
    const sections: PlanGroup['sections'] = []
    for (const [section, plans] of secMap) {
      sections.push({ section, plans })
    }
    result.push({ building, sections })
  }
  return result
}

export function PlansPage() {
  const { message } = App.useApp()
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const canUpload = profile?.is_active

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [loading, setLoading] = useState(false)

  // Upload
  const [uploading, setUploading] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadForm] = Form.useForm<UploadFormValues>()

  // Edit
  const [editPlan, setEditPlan] = useState<PlanRecord | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editForm] = Form.useForm<EditFormValues>()

  // Replace
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const [replacingPlan, setReplacingPlan] = useState<PlanRecord | null>(null)
  const [replacing, setReplacing] = useState(false)

  // Preview
  const [previewPlan, setPreviewPlan] = useState<PlanRecord | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewPage, setPreviewPage] = useState(1)
  const [previewPageCount, setPreviewPageCount] = useState(1)

  // Delete
  const [deleting, setDeleting] = useState<string | null>(null)

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

  // ---- Upload ----
  function handleFileSelected(file: UploadFile) {
    if (!projectId) {
      message.warning(plansPage.selectProjectFirst)
      return false
    }
    const realFile = file as unknown as File
    setPendingFile(realFile)
    uploadForm.setFieldsValue({ name: '', floor: '', building: '', section: '' })
    setUploadModalOpen(true)
    return false
  }

  async function handleUploadOk() {
    if (!pendingFile || !projectId) return
    try {
      const values = await uploadForm.validateFields()
      setUploadModalOpen(false)
      setUploading(true)
      await uploadPlanPdf(
        pendingFile,
        projectId,
        values.name,
        values.floor || null,
        values.building || null,
        values.section || null,
        null,
      )
      message.success(plansPage.uploadSuccess)
      setPendingFile(null)
      await reload()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  function handleUploadCancel() {
    setUploadModalOpen(false)
    setPendingFile(null)
  }

  // ---- Edit ----
  function openEdit(plan: PlanRecord) {
    setEditPlan(plan)
    editForm.setFieldsValue({
      name: plan.name,
      floor: plan.floor || '',
      building: plan.building || '',
      section: plan.section || '',
    })
  }

  async function handleEditOk() {
    if (!editPlan) return
    try {
      const values = await editForm.validateFields()
      setEditSaving(true)
      await updatePlan(editPlan.id, {
        name: values.name,
        floor: values.floor || null,
        building: values.building || null,
        section: values.section || null,
      })
      message.success(actions.save)
      setEditPlan(null)
      await reload()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setEditSaving(false)
    }
  }

  // ---- Replace ----
  function openReplace(plan: PlanRecord) {
    setReplacingPlan(plan)
    // Программный клик по скрытому input
    setTimeout(() => replaceInputRef.current?.click(), 0)
  }

  async function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Сбросим value чтобы можно было повторно выбрать тот же файл
    e.target.value = ''
    if (!file || !replacingPlan) {
      setReplacingPlan(null)
      return
    }
    try {
      setReplacing(true)
      await replacePlanFile(replacingPlan, file, null)
      message.success(plansPage.replaceSuccess)
      await reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err))
    } finally {
      setReplacing(false)
      setReplacingPlan(null)
    }
  }

  // ---- Delete ----
  async function handleDelete(plan: PlanRecord) {
    try {
      setDeleting(plan.id)
      await deletePlan(plan)
      message.success(plansPage.deleteSuccess)
      await reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(null)
    }
  }

  // ---- Preview ----
  async function openPreview(plan: PlanRecord) {
    setPreviewPlan(plan)
    setPreviewBlob(null)
    setPreviewPage(1)
    setPreviewPageCount(plan.page_count ?? 1)
    setPreviewLoading(true)
    try {
      const blob = await downloadPlanPdf(plan)
      setPreviewBlob(blob)
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
      setPreviewPlan(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handlePageCountReady = useCallback((n: number) => {
    setPreviewPageCount(n)
  }, [])

  function canDelete(plan: PlanRecord) {
    return isAdmin || plan.uploaded_by === profile?.id
  }

  // ---- Grouping ----
  const grouped = useMemo(() => groupPlans(plans), [plans])

  // ---- Render plan item ----
  function renderPlanItem(plan: PlanRecord) {
    const menuItems = [
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: actions.edit,
        onClick: () => openEdit(plan),
      },
      {
        key: 'replace',
        icon: <SwapOutlined />,
        label: plansPage.replaceFile,
        onClick: () => openReplace(plan),
      },
      ...(canDelete(plan)
        ? [
            {
              key: 'open',
              icon: <DownloadOutlined />,
              label: 'Открыть в новой вкладке',
              onClick: () => handleOpenTab(plan),
            },
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
                  onOk: () => handleDelete(plan),
                })
              },
            },
          ]
        : [
            {
              key: 'open',
              icon: <DownloadOutlined />,
              label: 'Открыть в новой вкладке',
              onClick: () => handleOpenTab(plan),
            },
          ]),
    ]

    return (
      <List.Item
        actions={[
          <Button
            key="preview"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => openPreview(plan)}
          >
            {plansPage.preview}
          </Button>,
          <Dropdown key="more" menu={{ items: menuItems }} trigger={['click']}>
            <Button
              type="text"
              icon={<EllipsisOutlined />}
              loading={deleting === plan.id || (replacing && replacingPlan?.id === plan.id)}
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

  async function handleOpenTab(plan: PlanRecord) {
    try {
      const blob = await downloadPlanPdf(plan)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  function renderPlanList(items: PlanRecord[]) {
    return (
      <List
        dataSource={items}
        locale={{ emptyText: 'Планов пока нет' }}
        renderItem={renderPlanItem}
      />
    )
  }

  return (
    <>
      <PageHeader title={nav.plans} subtitle={plansPage.subtitle} />
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Select
          allowClear
          placeholder={plansPage.allProjects}
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
              {projectId ? plansPage.dragHint : plansPage.selectProjectFirst}
            </p>
          </Upload.Dragger>
        )}

        {loading ? (
          <Flex justify="center" style={{ padding: 40 }}>
            <Spin />
          </Flex>
        ) : grouped ? (
          <Collapse
            defaultActiveKey={grouped.map((g) => g.building)}
            items={grouped.map((group) => ({
              key: group.building,
              label: group.building || plansPage.noBuilding,
              children:
                group.sections.length === 1 && !group.sections[0].section ? (
                  renderPlanList(group.sections[0].plans)
                ) : (
                  <Collapse
                    defaultActiveKey={group.sections.map((s) => s.section)}
                    items={group.sections.map((sec) => ({
                      key: sec.section,
                      label: sec.section || plansPage.noSection,
                      children: renderPlanList(sec.plans),
                    }))}
                  />
                ),
            }))}
          />
        ) : (
          renderPlanList(plans)
        )}
      </Space>

      {/* Скрытый input для замены файла */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleReplaceFile}
      />

      {/* Модалка загрузки */}
      <Modal
        title={plansPage.uploadTitle}
        open={uploadModalOpen}
        onOk={handleUploadOk}
        onCancel={handleUploadCancel}
        okText={plansPage.uploadBtn}
        cancelText={actions.cancel}
        confirmLoading={uploading}
        destroyOnClose
      >
        <Form form={uploadForm} layout="vertical">
          <Form.Item
            name="name"
            label={plansPage.fieldName}
            rules={[{ required: true, message: plansPage.requiredName }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="floor" label={plansPage.fieldFloor}>
            <Input placeholder={plansPage.fieldFloorHint} />
          </Form.Item>
          <Form.Item name="building" label={plansPage.fieldBuilding}>
            <Input placeholder={plansPage.fieldBuildingHint} />
          </Form.Item>
          <Form.Item name="section" label={plansPage.fieldSection}>
            <Input placeholder={plansPage.fieldSectionHint} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модалка редактирования */}
      <Modal
        title={plansPage.editTitle}
        open={!!editPlan}
        onOk={handleEditOk}
        onCancel={() => setEditPlan(null)}
        okText={actions.save}
        cancelText={actions.cancel}
        confirmLoading={editSaving}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label={plansPage.fieldName}
            rules={[{ required: true, message: plansPage.requiredName }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="floor" label={plansPage.fieldFloor}>
            <Input placeholder={plansPage.fieldFloorHint} />
          </Form.Item>
          <Form.Item name="building" label={plansPage.fieldBuilding}>
            <Input placeholder={plansPage.fieldBuildingHint} />
          </Form.Item>
          <Form.Item name="section" label={plansPage.fieldSection}>
            <Input placeholder={plansPage.fieldSectionHint} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Модалка просмотра */}
      <Modal
        title={previewPlan ? planDisplayName(previewPlan) : plansPage.previewTitle}
        open={!!previewPlan}
        onCancel={() => {
          setPreviewPlan(null)
          setPreviewBlob(null)
        }}
        footer={null}
        width="90vw"
        style={{ maxWidth: 960, top: 20 }}
        destroyOnClose
      >
        {previewLoading && (
          <Flex justify="center" style={{ padding: 60 }}>
            <Spin size="large" />
          </Flex>
        )}
        {previewBlob && (
          <>
            {previewPageCount > 1 && (
              <Flex justify="center" align="center" gap={12} style={{ marginBottom: 12 }}>
                <Button
                  icon={<LeftOutlined />}
                  disabled={previewPage <= 1}
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                />
                <Typography.Text>
                  {previewPage} {plansPage.pageOf} {previewPageCount}
                </Typography.Text>
                <Button
                  icon={<RightOutlined />}
                  disabled={previewPage >= previewPageCount}
                  onClick={() => setPreviewPage((p) => Math.min(previewPageCount, p + 1))}
                />
              </Flex>
            )}
            <PdfPlanCanvas
              blob={previewBlob}
              page={previewPage}
              value={null}
              onPageCountReady={handlePageCountReady}
            />
          </>
        )}
      </Modal>
    </>
  )
}
