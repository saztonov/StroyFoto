import type { ReactNode } from 'react'
import { Empty, Flex, Typography } from 'antd'

interface EmptySectionProps {
  title?: string
  description?: string
  extra?: ReactNode
}

/**
 * Пустое состояние раздела. Используется в заглушках каркаса:
 * страница рендерится корректно, но контента пока нет.
 */
export function EmptySection({ title, description, extra }: EmptySectionProps) {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: 320, width: '100%', padding: 16 }}
    >
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Flex vertical align="center" gap={4}>
            {title ? <Typography.Text strong>{title}</Typography.Text> : null}
            {description ? (
              <Typography.Text type="secondary">{description}</Typography.Text>
            ) : null}
          </Flex>
        }
      >
        {extra}
      </Empty>
    </Flex>
  )
}
