import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Select, Space, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd/es/upload/interface'
import { PageHeader } from '@/shared/ui/PageHeader'
import { nav, plansPage } from '@/shared/i18n/ru'
import { useAuth } from '@/app/providers/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  deletePlan,
  downloadPlanPdf,
  listAllVisiblePlans,
  listPlansForProject,
  replacePlanFile,
  updatePlan,
  uploadPlanPdf,
  type PlanRecord,
} from '@/services/plans'
import { groupPlans } from './lib/planGrouping'
import { PlanList } from './components/PlanList'
import { PlanUploadModal, type PlanFormValues } from './components/PlanUploadModal'
import { PlanEditModal } from './components/PlanEditModal'
import { PlanPreviewModal } from './components/PlanPreviewModal'

interface ProjectOption {
  id: string
  name: string
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

  // Edit
  const [editPlan, setEditPlan] = useState<PlanRecord | null>(null)
  const [editSaving, setEditSaving] = useState(false)

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
  }, [message])

  const reload = useCallback(async () => {
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
  }, [projectId, message])

  useEffect(() => {
    void reload()
  }, [reload])

  // ---- Upload ----
  function handleFileSelected(file: UploadFile) {
    if (!projectId) {
      message.warning(plansPage.selectProjectFirst)
      return false
    }
    setPendingFile(file as unknown as File)
    setUploadModalOpen(true)
    return false
  }

  async function handleUploadSubmit(values: PlanFormValues) {
    if (!pendingFile || !projectId) return
    setUploadModalOpen(false)
    setUploading(true)
    try {
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
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  // ---- Edit ----
  async function handleEditSubmit(values: PlanFormValues) {
    if (!editPlan) return
    setEditSaving(true)
    try {
      await updatePlan(editPlan.id, {
        name: values.name,
        floor: values.floor || null,
        building: values.building || null,
        section: values.section || null,
      })
      setEditPlan(null)
      await reload()
    } catch (e) {
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

  const grouped = useMemo(() => groupPlans(plans), [plans])

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

        <PlanList
          plans={plans}
          grouped={grouped}
          loading={loading}
          deletingId={deleting}
          replacing={replacing}
          replacingPlanId={replacingPlan?.id ?? null}
          canDelete={canDelete}
          onPreview={openPreview}
          onEdit={setEditPlan}
          onReplace={openReplace}
          onDelete={handleDelete}
        />
      </Space>

      {/* Скрытый input для замены файла */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleReplaceFile}
      />

      <PlanUploadModal
        open={uploadModalOpen}
        uploading={uploading}
        onSubmit={handleUploadSubmit}
        onCancel={() => {
          setUploadModalOpen(false)
          setPendingFile(null)
        }}
      />

      <PlanEditModal
        plan={editPlan}
        saving={editSaving}
        onSubmit={handleEditSubmit}
        onCancel={() => setEditPlan(null)}
      />

      <PlanPreviewModal
        plan={previewPlan}
        blob={previewBlob}
        loading={previewLoading}
        page={previewPage}
        pageCount={previewPageCount}
        onPageChange={setPreviewPage}
        onPageCountReady={handlePageCountReady}
        onClose={() => {
          setPreviewPlan(null)
          setPreviewBlob(null)
        }}
      />
    </>
  )
}
