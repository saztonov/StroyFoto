import { Button, Flex } from 'antd'
import { ZoomInOutlined, ZoomOutOutlined, UndoOutlined } from '@ant-design/icons'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { PdfPlanCanvas } from '@/pages/reports/components/PdfPlanCanvas'

interface Props {
  blob: Blob
  page: number
  onPageCountReady?: (n: number) => void
}

export function ZoomablePdfPreview({ blob, page, onPageCountReady }: Props) {
  return (
    <TransformWrapper
      initialScale={1}
      minScale={0.5}
      maxScale={5}
      centerOnInit
      wheel={{ step: 0.15 }}
      doubleClick={{ mode: 'toggle', step: 2 }}
    >
      {({ zoomIn, zoomOut, resetTransform }) => (
        <div style={{ position: 'relative' }}>
          <Flex
            gap={4}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10,
            }}
          >
            <Button
              size="small"
              icon={<ZoomInOutlined />}
              onClick={() => zoomIn()}
              title="Приблизить"
            />
            <Button
              size="small"
              icon={<ZoomOutOutlined />}
              onClick={() => zoomOut()}
              title="Отдалить"
            />
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={() => resetTransform()}
              title="Сбросить масштаб"
            />
          </Flex>
          <TransformComponent
            wrapperStyle={{
              width: '100%',
              maxHeight: '75vh',
              overflow: 'hidden',
              borderRadius: 6,
            }}
            contentStyle={{ width: '100%' }}
          >
            <PdfPlanCanvas
              blob={blob}
              page={page}
              value={null}
              onPageCountReady={onPageCountReady}
            />
          </TransformComponent>
        </div>
      )}
    </TransformWrapper>
  )
}
