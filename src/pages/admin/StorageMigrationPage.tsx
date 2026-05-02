import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Flex,
  List,
  Progress,
  Space,
  Tag,
  Typography,
} from 'antd'
import { CloudUploadOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { PageHeader } from '@/shared/ui/PageHeader'
import {
  loadMigrationOverview,
  runMigration,
  type MigrationLogEntry,
  type MigrationStats,
} from '@/services/storageMigration'

const MAX_LOG_ENTRIES = 200

export function StorageMigrationPage() {
  const { message } = App.useApp()
  const [stats, setStats] = useState<MigrationStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<MigrationLogEntry[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const refreshOverview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ov = await loadMigrationOverview()
      setStats(ov)
      setFinished(ov.totalRows === 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  const start = useCallback(async () => {
    if (!stats || running) return
    setRunning(true)
    setError(null)
    setLogs([])
    setFinished(false)
    abortRef.current = new AbortController()

    try {
      await runMigration((event) => {
        setStats({ ...event.stats })
        if (event.log) {
          setLogs((prev) => {
            const next = [event.log!, ...prev]
            return next.slice(0, MAX_LOG_ENTRIES)
          })
        }
        if (event.finished) {
          setFinished(true)
        }
      }, abortRef.current.signal)
      message.success('Миграция завершена')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      message.error(`Миграция остановлена: ${msg}`)
    } finally {
      setRunning(false)
      abortRef.current = null
      // Перечитаем актуальный счётчик с сервера, чтобы цифры точно совпадали
      // с реальностью даже после ошибок.
      void refreshOverview()
    }
  }, [stats, running, message, refreshOverview])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const totalDone = stats?.doneObjects ?? 0
  const totalErr = stats?.errorObjects ?? 0
  const totalAll = stats?.totalObjects ?? 0
  const percent = useMemo(() => {
    if (!totalAll) return finished ? 100 : 0
    return Math.min(100, Math.round(((totalDone + totalErr) / totalAll) * 100))
  }, [totalDone, totalErr, totalAll, finished])

  const isAllDone = finished && totalErr === 0 && (totalAll === 0 || totalDone === totalAll)
  const hasErrors = totalErr > 0

  return (
    <>
      <PageHeader
        title="Перенос файлов на Cloud.ru S3"
        subtitle="Копирует исторические объекты из Cloudflare R2 в Cloud.ru Object Storage"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refreshOverview} disabled={running || loading}>
              Обновить
            </Button>
            {!running ? (
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={start}
                disabled={loading || (stats?.totalRows ?? 0) === 0}
              >
                Запустить миграцию
              </Button>
            ) : (
              <Button danger icon={<StopOutlined />} onClick={stop}>
                Остановить
              </Button>
            )}
          </Space>
        }
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Как это работает"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                Страница доступна только администратору. Backend
                `/api/storage/presign` проверяет роль и не выпускает presigned
                URL к R2 для обычных пользователей.
              </li>
              <li>
                Для каждого фото / плана со значением{' '}
                <Tag color="orange">storage=r2</Tag> файл скачивается из R2
                и заливается в Cloud.ru с тем же object key. После успешной
                заливки колонка обновляется на <Tag color="green">cloudru</Tag>.
              </li>
              <li>
                Миграция идемпотентна: если что-то упало посреди процесса —
                просто запустите её снова, перенесутся только оставшиеся
                объекты.
              </li>
              <li>
                Когда счётчик «Осталось переехать» = 0, секреты Cloudflare R2
                на сервере (server/.env) можно отзывать.
              </li>
            </ul>
          }
        />

        {error && <Alert type="error" showIcon message={error} closable />}

        {isAllDone && (
          <Alert
            type="success"
            showIcon
            message="Все объекты переехали в Cloud.ru"
            description="Storage=r2 строк больше нет. Можно удалять секреты R2 из конфигурации сервера."
          />
        )}

        {hasErrors && !running && (
          <Alert
            type="warning"
            showIcon
            message={`При переносе зафиксировано ошибок: ${totalErr}`}
            description="Запустите миграцию ещё раз — система попробует перенести только проблемные объекты. Если проблема повторяется — посмотрите подробности в логе ниже."
          />
        )}

        <Card title="Состояние">
          {!stats ? (
            <Typography.Text type="secondary">Загружаем статистику…</Typography.Text>
          ) : (
            <>
              <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
                <Descriptions.Item label="Записей в БД на R2">
                  <Tag color={stats.totalRows > 0 ? 'orange' : 'green'}>{stats.totalRows}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Объектов всего">{stats.totalObjects}</Descriptions.Item>
                <Descriptions.Item label="Перенесено">
                  <Tag color="green">{stats.doneObjects}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="С ошибкой">
                  <Tag color={stats.errorObjects > 0 ? 'red' : 'default'}>{stats.errorObjects}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Осталось переехать">
                  {Math.max(0, stats.totalObjects - stats.doneObjects - stats.errorObjects)}
                </Descriptions.Item>
                <Descriptions.Item label="Прогресс">
                  <Progress
                    percent={percent}
                    status={running ? 'active' : isAllDone ? 'success' : hasErrors ? 'exception' : 'normal'}
                    size="small"
                    style={{ minWidth: 180 }}
                  />
                </Descriptions.Item>
              </Descriptions>
            </>
          )}
        </Card>

        <Card
          title={
            <Flex justify="space-between" align="center">
              <span>Лог миграции</span>
              {logs.length > 0 && (
                <Button size="small" type="text" onClick={() => setLogs([])}>
                  Очистить
                </Button>
              )}
            </Flex>
          }
        >
          {logs.length === 0 ? (
            <Typography.Text type="secondary">
              Лог пуст. Запустите миграцию, чтобы увидеть детали по каждому объекту.
            </Typography.Text>
          ) : (
            <List
              dataSource={logs}
              size="small"
              renderItem={(entry) => (
                <List.Item style={{ paddingInline: 0 }}>
                  <Flex gap={8} align="center" style={{ width: '100%' }}>
                    <Typography.Text type="secondary" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 70 }}>
                      {dayjs(entry.timestamp).format('HH:mm:ss')}
                    </Typography.Text>
                    <Tag
                      color={
                        entry.level === 'success'
                          ? 'green'
                          : entry.level === 'error'
                            ? 'red'
                            : entry.level === 'warn'
                              ? 'orange'
                              : 'blue'
                      }
                    >
                      {entry.level}
                    </Tag>
                    <Typography.Text style={{ flex: 1, wordBreak: 'break-word' }}>
                      {entry.message}
                    </Typography.Text>
                  </Flex>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Space>
    </>
  )
}
