import { Flex, Typography } from 'antd'
import { CheckCircleFilled } from '@ant-design/icons'
import { planMarks } from '@/shared/i18n/ru'
import type { MarkablePhoto } from '../lib/markablePhotos'

/**
 * Что именно получит следующий клик по плану: общую метку отчёта или точку
 * конкретной фотографии.
 */
export type MarkTarget = { kind: 'report' } | { kind: 'photo'; photoId: string }

export function targetKey(t: MarkTarget): string {
  return t.kind === 'report' ? 'report' : t.photoId
}

interface Props {
  /** Только сферические снимки — обычные в ленту не попадают. */
  photos: MarkablePhoto[]
  markedPhotoIds: ReadonlySet<string>
  hasLegacyMark: boolean
  selected: MarkTarget
  onSelect: (t: MarkTarget) => void
}

/**
 * Лента выбора цели для точки. Про PDF ничего не знает — только про выбор.
 *
 * Первый элемент «Отчёт» — существующая общая метка. Без него отчёты без
 * сферических снимков потеряли бы возможность указать план вообще.
 */
export function PhotoMarkStrip({
  photos,
  markedPhotoIds,
  hasLegacyMark,
  selected,
  onSelect,
}: Props) {
  const selectedKey = targetKey(selected)

  const itemStyle = (active: boolean): React.CSSProperties => ({
    position: 'relative',
    flex: '0 0 auto',
    padding: 4,
    borderRadius: 8,
    border: active
      ? '2px solid var(--ant-color-primary)'
      : '2px solid transparent',
    background: 'transparent',
    cursor: 'pointer',
    lineHeight: 0,
  })

  return (
    <Flex
      gap={8}
      align="center"
      style={{ overflowX: 'auto', paddingBottom: 4 }}
      role="listbox"
      aria-label={planMarks.stripLabel}
    >
      <button
        type="button"
        role="option"
        aria-selected={selectedKey === 'report'}
        onClick={() => onSelect({ kind: 'report' })}
        style={{ ...itemStyle(selectedKey === 'report'), minWidth: 72, height: 64 }}
      >
        <Typography.Text style={{ fontSize: 12 }}>
          {planMarks.wholeReport}
        </Typography.Text>
        {hasLegacyMark && (
          <CheckCircleFilled
            style={{ position: 'absolute', right: 2, top: 2, color: '#52c41a', fontSize: 12 }}
          />
        )}
      </button>

      {photos.map((p, idx) => {
        const active = selectedKey === p.id
        const marked = markedPhotoIds.has(p.id)
        return (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={active}
            aria-label={`${planMarks.photoNumber} ${idx + 1}${marked ? `, ${planMarks.markSet}` : ''}`}
            onClick={() => onSelect({ kind: 'photo', photoId: p.id })}
            style={itemStyle(active)}
          >
            <img
              src={p.thumbUrl}
              alt=""
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6 }}
            />
            <span
              style={{
                position: 'absolute',
                left: 6,
                bottom: 6,
                minWidth: 18,
                height: 18,
                padding: '0 4px',
                borderRadius: 9,
                background: 'rgba(0,0,0,0.65)',
                color: '#fff',
                fontSize: 11,
                lineHeight: '18px',
                textAlign: 'center',
              }}
            >
              {idx + 1}
            </span>
            {marked && (
              <CheckCircleFilled
                style={{ position: 'absolute', right: 6, top: 6, color: '#52c41a', fontSize: 14 }}
              />
            )}
          </button>
        )
      })}
    </Flex>
  )
}
