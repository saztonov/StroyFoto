import { Card, Image, Skeleton, Space, Tag, Typography } from 'antd'
import { photo360, reportDetails } from '@/shared/i18n/ru'
import { isPanoramaByRatio } from '@/shared/lib/isPanorama'
import type { DisplayPhoto } from '../types'

interface Props {
  photos: DisplayPhoto[]
  expectedCount: number
  remotePhotosLoading: boolean
  onPanoClick: (src: string) => void
}

export function ReportPhotosCard({ photos, expectedCount, remotePhotosLoading, onPanoClick }: Props) {
  const showInitialLoading =
    remotePhotosLoading && photos.length === 0 && expectedCount > 0

  return (
    <Card title={reportDetails.sectionPhotos}>
      {showInitialLoading ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary">{reportDetails.loadingPhotos}</Typography.Text>
          <Space wrap size={8}>
            {Array.from({ length: expectedCount }).map((_, i) => (
              <Skeleton.Image
                key={`photo-skel-${i}`}
                active
                style={{ width: 120, height: 120, borderRadius: 6 }}
              />
            ))}
          </Space>
        </Space>
      ) : photos.length === 0 ? (
        <Typography.Text type="secondary">
          {expectedCount > 0 ? reportDetails.photoUnavailable : reportDetails.noPhotos}
        </Typography.Text>
      ) : (
        <PhotosGrid
          photos={photos}
          remaining={
            remotePhotosLoading && expectedCount > photos.length
              ? expectedCount - photos.length
              : 0
          }
          onPanoClick={onPanoClick}
        />
      )}
    </Card>
  )
}

interface GridProps {
  photos: DisplayPhoto[]
  remaining: number
  onPanoClick: (src: string) => void
}

function PhotosGrid({ photos, remaining, onPanoClick }: GridProps) {
  return (
    <Image.PreviewGroup
      items={photos
        .filter((p) => !isPanoramaByRatio(p.width, p.height))
        .map((p) => p.fullUrl)}
    >
      <Space wrap size={8}>
        {photos.map((p) => {
          const isPano = isPanoramaByRatio(p.width, p.height)
          if (isPano) {
            return (
              <div
                key={p.id}
                onClick={() => onPanoClick(p.fullUrl)}
                style={{
                  position: 'relative',
                  width: 120,
                  height: 120,
                  borderRadius: 6,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'var(--ant-color-fill-quaternary)',
                }}
              >
                <img
                  src={p.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <Tag
                  color="blue"
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    margin: 0,
                    fontSize: 11,
                    lineHeight: '16px',
                    padding: '0 6px',
                  }}
                >
                  {photo360.badge}
                </Tag>
              </div>
            )
          }
          return (
            <Image
              key={p.id}
              src={p.thumbUrl}
              preview={{ src: p.fullUrl }}
              width={120}
              height={120}
              style={{ objectFit: 'cover', borderRadius: 6 }}
              fallback="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4="
            />
          )
        })}
        {Array.from({ length: remaining }).map((_, i) => (
          <Skeleton.Image
            key={`photo-skel-tail-${i}`}
            active
            style={{ width: 120, height: 120, borderRadius: 6 }}
          />
        ))}
      </Space>
    </Image.PreviewGroup>
  )
}
