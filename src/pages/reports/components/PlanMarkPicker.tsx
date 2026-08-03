import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Flex, Select, Space, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { LocalPhotoMark } from '@/lib/db'
import type { PlanRow } from '@/services/catalogs'
import { downloadPlanPdf, planDisplayName, planRowToRecord } from '@/services/plans'
import { planMarks as t } from '@/shared/i18n/ru'
import type { MarkablePhoto } from '../lib/markablePhotos'
import { PdfPlanCanvas, type PdfPlanPoint } from './PdfPlanCanvas'
import { PhotoMarkStrip, targetKey, type MarkTarget } from './PhotoMarkStrip'

/** Общая метка отчёта. Координаты могут отсутствовать: план выбран, точка — нет. */
export interface PlanMarkValue {
  planId: string
  page: number
  xNorm: number | null
  yNorm: number | null
}

/**
 * Значение компонента.
 *
 * `reportPlanId` хранится отдельно от меток намеренно: сегодня можно выбрать
 * план и не ставить точку, и именно из него берётся `reports.plan_id`. Свести
 * его к «плану легаси-метки» нельзя — состояние потерялось бы при сохранении.
 */
export interface PlanMarksValue {
  reportPlanId: string | null
  legacyMark: PlanMarkValue | null
  photoMarks: LocalPhotoMark[]
}

interface Props {
  plans: PlanRow[]
  /** Уже отфильтрованные сферические снимки. */
  photos: MarkablePhoto[]
  value: PlanMarksValue
  onChange: (next: PlanMarksValue) => void
}

/**
 * Выбор плана и постановка точек: общей для отчёта и по одной на 360-фото.
 *
 * Ключевой принцип — «что открыто» отделено от «что сохранено». Навигация по
 * планам и страницам меняет только вид; координаты записывает исключительно
 * клик по холсту. Прежняя версия писала страницу прямо в метку, и при наборе
 * точек листание переносило бы чужую точку.
 */
export function PlanMarkPicker({ plans, photos, value, onChange }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number>(1)

  // --- состояние вида (в данные не попадает) ---------------------------------
  const [viewPlanId, setViewPlanId] = useState<string | null>(value.reportPlanId)
  const [viewPage, setViewPage] = useState(1)
  const [selected, setSelected] = useState<MarkTarget>(
    photos.length > 0 ? { kind: 'photo', photoId: photos[0].id } : { kind: 'report' },
  )

  const markByPhoto = useMemo(
    () => new Map(value.photoMarks.map((m) => [m.photoId, m])),
    [value.photoMarks],
  )

  // Выбранное фото исчезло (удалили) — переводим выбор на следующее доступное.
  useEffect(() => {
    if (selected.kind !== 'photo') return
    if (photos.some((p) => p.id === selected.photoId)) return
    const next = photos.find((p) => !markByPhoto.has(p.id)) ?? photos[0]
    setSelected(next ? { kind: 'photo', photoId: next.id } : { kind: 'report' })
  }, [photos, selected, markByPhoto])

  useEffect(() => {
    if (!viewPlanId) {
      setBlob(null)
      setError(null)
      setPageCount(1)
      return
    }
    const plan = plans.find((p) => p.id === viewPlanId)
    if (!plan) return

    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const b = await downloadPlanPdf(planRowToRecord(plan))
        if (!cancelled) setBlob(b)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [viewPlanId, plans])

  if (plans.length === 0) {
    return <Typography.Text type="secondary">У проекта пока нет загруженных планов</Typography.Text>
  }

  /** Точка выбранной цели, если она есть. */
  const selectedMark =
    selected.kind === 'report'
      ? value.legacyMark && value.legacyMark.xNorm != null
        ? { planId: value.legacyMark.planId, page: value.legacyMark.page }
        : null
      : markByPhoto.get(selected.photoId) ?? null

  const handlePlanChange = (planId: string | null) => {
    // Меняется только вид. Уже поставленные точки остаются на своих планах —
    // именно так реализуется «точки могут быть на разных планах».
    setViewPlanId(planId)
    setViewPage(1)
    onChange({ ...value, reportPlanId: planId })
  }

  const handlePageShift = (delta: number) => {
    setViewPage((p) => Math.max(1, Math.min(pageCount, p + delta)))
  }

  /** Переключить выбор и, если у цели есть точка, открыть её план и страницу. */
  const handleSelect = (t2: MarkTarget) => {
    setSelected(t2)
    const mark =
      t2.kind === 'report'
        ? value.legacyMark && value.legacyMark.xNorm != null
          ? { planId: value.legacyMark.planId, page: value.legacyMark.page }
          : null
        : markByPhoto.get(t2.photoId) ?? null
    if (mark) {
      setViewPlanId(mark.planId)
      setViewPage(mark.page)
    }
  }

  const advance = () => {
    const rest = photos.filter(
      (p) => !(selected.kind === 'photo' && p.id === selected.photoId) && !markByPhoto.has(p.id),
    )
    if (rest.length > 0) setSelected({ kind: 'photo', photoId: rest[0].id })
  }

  const handlePick = (p: { xNorm: number; yNorm: number }) => {
    if (!viewPlanId) return
    if (selected.kind === 'report') {
      onChange({
        ...value,
        reportPlanId: viewPlanId,
        legacyMark: { planId: viewPlanId, page: viewPage, xNorm: p.xNorm, yNorm: p.yNorm },
      })
    } else {
      const others = value.photoMarks.filter((m) => m.photoId !== selected.photoId)
      onChange({
        ...value,
        reportPlanId: value.reportPlanId ?? viewPlanId,
        photoMarks: [
          ...others,
          {
            photoId: selected.photoId,
            planId: viewPlanId,
            page: viewPage,
            xNorm: p.xNorm,
            yNorm: p.yNorm,
          },
        ],
      })
    }
    advance()
  }

  const handleClear = () => {
    if (selected.kind === 'report') {
      onChange({ ...value, legacyMark: null })
    } else {
      onChange({
        ...value,
        photoMarks: value.photoMarks.filter((m) => m.photoId !== selected.photoId),
      })
    }
  }

  /** Точки текущего плана и страницы. */
  const points: PdfPlanPoint[] = []
  if (
    value.legacyMark &&
    value.legacyMark.xNorm != null &&
    value.legacyMark.yNorm != null &&
    value.legacyMark.planId === viewPlanId &&
    value.legacyMark.page === viewPage
  ) {
    points.push({
      id: 'report',
      xNorm: value.legacyMark.xNorm,
      yNorm: value.legacyMark.yNorm,
      active: selected.kind === 'report',
      ariaLabel: t.wholeReport,
    })
  }
  photos.forEach((photo, idx) => {
    const m = markByPhoto.get(photo.id)
    if (!m || m.planId !== viewPlanId || m.page !== viewPage) return
    points.push({
      id: photo.id,
      xNorm: m.xNorm,
      yNorm: m.yNorm,
      label: String(idx + 1),
      active: selected.kind === 'photo' && selected.photoId === photo.id,
      ariaLabel: `${t.photoNumber} ${idx + 1}`,
    })
  })

  const nowPlacing =
    selected.kind === 'report'
      ? t.nowPlacingReport
      : `${t.photoNumber} №${photos.findIndex((p) => p.id === selected.photoId) + 1}`

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Select
        placeholder="Выберите план"
        allowClear
        value={viewPlanId ?? undefined}
        onChange={(v) => handlePlanChange(v ?? null)}
        options={plans.map((p) => ({ value: p.id, label: planDisplayName(p) }))}
      />

      {viewPlanId && (
        <>
          <Flex gap={8} align="center" wrap="wrap">
            <Button icon={<LeftOutlined />} onClick={() => handlePageShift(-1)} disabled={viewPage <= 1} />
            <Typography.Text>
              Страница {viewPage} из {pageCount}
            </Typography.Text>
            <Button
              icon={<RightOutlined />}
              onClick={() => handlePageShift(1)}
              disabled={viewPage >= pageCount}
            />
            <Button size="small" onClick={handleClear} disabled={!selectedMark}>
              {t.clearPoint}
            </Button>
          </Flex>

          {loading && <Typography.Text type="secondary">Загрузка PDF…</Typography.Text>}
          {error && !blob && (
            <Alert
              type="warning"
              showIcon
              message="План не загружен"
              description={
                typeof navigator !== 'undefined' && !navigator.onLine
                  ? 'Подключитесь к интернету хотя бы один раз, чтобы скачать PDF плана. Отчёт можно сохранить и без точки на плане.'
                  : `Не удалось скачать план: ${error}. Попробуйте позже или сохраните отчёт без точки.`
              }
            />
          )}
          {blob && (
            <PdfPlanCanvas
              blob={blob}
              page={viewPage}
              points={points}
              onPageCountReady={setPageCount}
              onPick={handlePick}
              onPointClick={(id) =>
                handleSelect(id === 'report' ? { kind: 'report' } : { kind: 'photo', photoId: id })
              }
            />
          )}

          {/* Строка состояния обязательна: клик автоматически переводит выбор на
              следующий кадр, и без неё пользователь, желающий уточнить только что
              поставленную точку, назначил бы её другому снимку. */}
          <Flex gap={8} align="center" wrap="wrap">
            <Typography.Text strong>
              {t.nowPlacing}: {nowPlacing}
            </Typography.Text>
            {photos.length > 0 && (
              <Button size="small" onClick={advance}>
                {t.next}
              </Button>
            )}
          </Flex>

          {photos.length > 0 ? (
            <PhotoMarkStrip
              photos={photos}
              markedPhotoIds={new Set(markByPhoto.keys())}
              hasLegacyMark={Boolean(value.legacyMark?.xNorm != null)}
              selected={selected}
              onSelect={handleSelect}
            />
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t.noPanoramas}
            </Typography.Text>
          )}

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t.hint}
          </Typography.Text>
        </>
      )}
    </Space>
  )
}

export { targetKey }
export type { MarkTarget }
