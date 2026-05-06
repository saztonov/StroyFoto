import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Descriptions,
  Empty,
  Flex,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  DownOutlined,
  LeftOutlined,
  RightOutlined,
  UpOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { reportDetails, reportsList, photo360 } from '@/shared/i18n/ru'
import { isPanoramaByRatio } from '@/shared/lib/isPanorama'
import { getDB, type LocalPhoto } from '@/lib/db'
import {
  cacheRemotePhotoBlob,
  getCachedRemotePhotoBlob,
} from '@/services/reports'
import type {
  ReportCard,
  RemoteReportPhoto,
} from '@/services/reports'
import { requestPresigned } from '@/services/objectStorage'
import type { Project } from '@/entities/project/types'
import type { WorkType } from '@/entities/workType/types'
import type { Performer } from '@/entities/performer/types'
import type { WorkAssignment } from '@/entities/workAssignment/types'
import { Photo360Viewer } from './Photo360Viewer'

interface FeedItem {
  reportId: string
  reportIndex: number
  photoIndexInReport: number
  photoCountInReport: number
  photoId: string
  width: number | null
  height: number | null
  source:
    | { kind: 'remote'; meta: RemoteReportPhoto }
    | { kind: 'local'; photo: LocalPhoto }
}

interface PhotoFeedViewProps {
  reports: ReportCard[]
  photosByReportId: Map<string, RemoteReportPhoto[]>
  projectsById: Map<string, Project>
  workTypesById: Map<string, WorkType>
  performersById: Map<string, Performer>
  workAssignmentsById: Map<string, WorkAssignment>
  /** Текущий query — пробрасываем в URL детали, чтобы «Назад» восстановило фильтры. */
  searchQuery: string
}

export function PhotoFeedView({
  reports,
  photosByReportId,
  projectsById,
  workTypesById,
  performersById,
  workAssignmentsById,
  searchQuery,
}: PhotoFeedViewProps) {
  const navigate = useNavigate()

  const [items, setItems] = useState<FeedItem[]>([])
  const [collecting, setCollecting] = useState(true)
  const [activeIndex, setActiveIndex] = useState(0)
  // Map<photoId, objectUrl>; держим только окно вокруг activeIndex.
  const [blobUrls, setBlobUrls] = useState<Map<string, string>>(new Map())
  const [pano360Src, setPano360Src] = useState<string | null>(null)
  const [photoLoading, setPhotoLoading] = useState(false)

  // Сборка плоского списка фото из отчётов.
  // Для remote — из props.photosByReportId; для локальных draft — из IDB.
  useEffect(() => {
    let cancelled = false
    setCollecting(true)
    void (async () => {
      const db = await getDB()
      const next: FeedItem[] = []
      for (let ri = 0; ri < reports.length; ri++) {
        const r = reports[ri]
        if (r.remoteOnly) {
          const photos = photosByReportId.get(r.id) ?? []
          for (let pi = 0; pi < photos.length; pi++) {
            next.push({
              reportId: r.id,
              reportIndex: ri,
              photoIndexInReport: pi,
              photoCountInReport: photos.length,
              photoId: photos[pi].id,
              width: photos[pi].width,
              height: photos[pi].height,
              source: { kind: 'remote', meta: photos[pi] },
            })
          }
        } else {
          // Локальный draft — фото в IDB store 'photos' с origin='local'.
          const local = await db.getAllFromIndex('photos', 'by_report', r.id)
          const sorted = local
            .filter((p) => p.origin === 'local')
            .sort((a, b) => a.order - b.order)
          for (let pi = 0; pi < sorted.length; pi++) {
            next.push({
              reportId: r.id,
              reportIndex: ri,
              photoIndexInReport: pi,
              photoCountInReport: sorted.length,
              photoId: sorted[pi].id,
              width: sorted[pi].width || null,
              height: sorted[pi].height || null,
              source: { kind: 'local', photo: sorted[pi] },
            })
          }
        }
      }
      if (cancelled) return
      setItems(next)
      setActiveIndex((prev) => Math.min(prev, Math.max(0, next.length - 1)))
      setCollecting(false)
    })()
    return () => {
      cancelled = true
    }
  }, [reports, photosByReportId])

  // Окно prefetch: текущий и ±1.
  // Загружаем blob для нужного фото; отзываем URL'ы вне окна, чтобы не
  // удерживать большие блобы в памяти при длинной ленте.
  useEffect(() => {
    if (items.length === 0) return
    let cancelled = false
    const wanted = new Set<number>(
      [activeIndex - 1, activeIndex, activeIndex + 1].filter(
        (i) => i >= 0 && i < items.length,
      ),
    )
    const wantedIds = new Set<string>()
    for (const i of wanted) wantedIds.add(items[i].photoId)

    void (async () => {
      // 1. Отзовём URL'ы, которые больше не нужны.
      setBlobUrls((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [pid, url] of prev) {
          if (!wantedIds.has(pid)) {
            URL.revokeObjectURL(url)
            next.delete(pid)
            changed = true
          }
        }
        return changed ? next : prev
      })

      // 2. Подгрузим недостающие.
      for (const i of wanted) {
        const it = items[i]
        if (cancelled) return
        if (blobUrls.has(it.photoId)) continue
        if (i === activeIndex) setPhotoLoading(true)
        try {
          let blob: Blob | null = null
          if (it.source.kind === 'local') {
            blob = it.source.photo.blob
          } else {
            // Сначала кэш IDB (origin='remote'), затем presigned GET.
            const cached = await getCachedRemotePhotoBlob(it.photoId)
            if (cached?.blob) {
              blob = cached.blob
            } else {
              const online =
                typeof navigator === 'undefined' ? true : navigator.onLine
              if (!online) {
                if (i === activeIndex) setPhotoLoading(false)
                continue
              }
              const pre = await requestPresigned({
                op: 'get',
                kind: 'photo',
                key: it.source.meta.object_key,
                reportId: it.reportId,
              })
              const resp = await fetch(pre.url)
              if (!resp.ok) {
                if (i === activeIndex) setPhotoLoading(false)
                continue
              }
              blob = await resp.blob()
              try {
                await cacheRemotePhotoBlob(it.reportId, it.photoId, blob, null)
              } catch {
                // не критично — fallback без кэша
              }
            }
          }
          if (cancelled || !blob) continue
          const url = URL.createObjectURL(blob)
          setBlobUrls((prev) => {
            if (prev.has(it.photoId)) {
              URL.revokeObjectURL(url)
              return prev
            }
            const next = new Map(prev)
            next.set(it.photoId, url)
            return next
          })
        } catch {
          // тихий fallback — placeholder
        } finally {
          if (i === activeIndex && !cancelled) setPhotoLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blobUrls внутри функции читается, но менять deps нельзя — это вызовет петлю
  }, [items, activeIndex])

  // Cleanup всех URL при unmount.
  useEffect(() => {
    return () => {
      setBlobUrls((prev) => {
        for (const url of prev.values()) URL.revokeObjectURL(url)
        return new Map()
      })
    }
  }, [])

  const goPhoto = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => {
        if (items.length === 0) return 0
        const next = prev + delta
        if (next < 0) return 0
        if (next >= items.length) return items.length - 1
        return next
      })
    },
    [items.length],
  )

  const goReport = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => {
        if (items.length === 0) return 0
        const cur = items[prev]
        if (!cur) return 0
        const targetReportIndex = cur.reportIndex + delta
        if (targetReportIndex < 0 || targetReportIndex >= reports.length) {
          return prev
        }
        // Найти первый FeedItem с reportIndex === targetReportIndex.
        const found = items.findIndex(
          (it) => it.reportIndex === targetReportIndex,
        )
        if (found < 0) {
          // У целевого отчёта нет фото — попробуем перепрыгнуть дальше в ту же сторону.
          const dir = delta > 0 ? 1 : -1
          let next = targetReportIndex + dir
          while (next >= 0 && next < reports.length) {
            const idx = items.findIndex((it) => it.reportIndex === next)
            if (idx >= 0) return idx
            next += dir
          }
          return prev
        }
        return found
      })
    },
    [items, reports.length],
  )

  // Клавиатурная навигация.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
          return
        }
      }
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          goPhoto(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          goPhoto(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          goReport(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          goReport(1)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPhoto, goReport])

  const active = items[activeIndex] ?? null
  const activeReport = useMemo<ReportCard | null>(() => {
    if (!active) return null
    return reports[active.reportIndex] ?? null
  }, [active, reports])
  const activeUrl = active ? blobUrls.get(active.photoId) ?? null : null
  const isPano = active ? isPanoramaByRatio(active.width, active.height) : false

  const handleOpenReport = useCallback(() => {
    if (!activeReport) return
    navigate(
      searchQuery
        ? `/reports/${activeReport.id}?${searchQuery}`
        : `/reports/${activeReport.id}`,
    )
  }, [activeReport, navigate, searchQuery])

  if (collecting) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: 200 }}>
        <Spin />
      </Flex>
    )
  }

  if (reports.length === 0) {
    return <Empty description={reportsList.emptyFiltered} />
  }

  if (items.length === 0) {
    return <Empty description={reportsList.photoFeedEmpty} />
  }

  const projectName = activeReport
    ? projectsById.get(activeReport.projectId)?.name ?? '—'
    : '—'
  const workTypeName = activeReport
    ? workTypesById.get(activeReport.workTypeId)?.name ?? '—'
    : '—'
  const performer = activeReport
    ? performersById.get(activeReport.performerId)
    : undefined
  const workAssignmentName =
    activeReport && activeReport.workAssignmentId
      ? workAssignmentsById.get(activeReport.workAssignmentId)?.name ?? '—'
      : '—'

  return (
    <>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {reportsList.photoFeedHint}
        </Typography.Text>

        <div
          style={{
            position: 'relative',
            width: '100%',
            background: 'var(--ant-color-fill-quaternary)',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 240,
            maxHeight: '60vh',
          }}
        >
          {photoLoading && !activeUrl && (
            <Flex align="center" gap={8}>
              <Spin />
              <Typography.Text type="secondary">
                {reportsList.photoFeedLoadingPhoto}
              </Typography.Text>
            </Flex>
          )}
          {!photoLoading && !activeUrl && (
            <Typography.Text type="secondary">
              {reportsList.photoFeedPhotoUnavailable}
            </Typography.Text>
          )}
          {activeUrl && (
            <img
              src={activeUrl}
              alt=""
              style={{
                maxWidth: '100%',
                maxHeight: '60vh',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          )}
          {isPano && activeUrl && (
            <Tag
              color="blue"
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                margin: 0,
              }}
            >
              {photo360.badge}
            </Tag>
          )}
        </div>

        <Flex justify="space-between" align="center" wrap="wrap" gap={8}>
          <Space size={4}>
            <Button
              icon={<LeftOutlined />}
              onClick={() => goPhoto(-1)}
              disabled={activeIndex <= 0}
              title={reportsList.photoFeedPrevPhoto}
            />
            <Button
              icon={<RightOutlined />}
              onClick={() => goPhoto(1)}
              disabled={activeIndex >= items.length - 1}
              title={reportsList.photoFeedNextPhoto}
            />
          </Space>
          {active && (
            <Typography.Text type="secondary">
              {`${active.photoIndexInReport + 1} / ${active.photoCountInReport} · ${active.reportIndex + 1} / ${reports.length}`}
            </Typography.Text>
          )}
          <Space size={4}>
            <Button
              icon={<UpOutlined />}
              onClick={() => goReport(-1)}
              disabled={!active || active.reportIndex <= 0}
              title={reportsList.photoFeedPrevReport}
            />
            <Button
              icon={<DownOutlined />}
              onClick={() => goReport(1)}
              disabled={!active || active.reportIndex >= reports.length - 1}
              title={reportsList.photoFeedNextReport}
            />
          </Space>
        </Flex>

        {activeReport && (
          <Descriptions
            column={1}
            size="small"
            bordered
            style={{ background: 'var(--ant-color-bg-container)' }}
          >
            <Descriptions.Item label={reportDetails.project}>
              {projectName}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.workType}>
              {workTypeName}
            </Descriptions.Item>
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
            <Descriptions.Item label={reportDetails.takenAt}>
              {activeReport.takenAt
                ? dayjs(activeReport.takenAt).format('DD.MM.YYYY HH:mm')
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.createdAt}>
              {dayjs(activeReport.createdAt).format('DD.MM.YYYY HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.author}>
              {activeReport.authorName ?? activeReport.authorId}
            </Descriptions.Item>
            <Descriptions.Item label={reportDetails.description}>
              {activeReport.description || '—'}
            </Descriptions.Item>
          </Descriptions>
        )}

        <Space wrap>
          <Button type="primary" onClick={handleOpenReport} disabled={!activeReport}>
            {reportsList.photoFeedOpenReport}
          </Button>
          {isPano && activeUrl && (
            <Button onClick={() => setPano360Src(activeUrl)}>
              {reportsList.photoFeedOpen360}
            </Button>
          )}
        </Space>
      </Space>

      <Photo360Viewer
        open={pano360Src !== null}
        src={pano360Src}
        onClose={() => setPano360Src(null)}
      />
    </>
  )
}
