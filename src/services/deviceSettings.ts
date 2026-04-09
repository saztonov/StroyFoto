import { getDB, type RetentionSetting } from '@/lib/db'

const RETENTION_KEY = 'retention'
const DEFAULT_RETENTION: RetentionSetting = { mode: 'all' }

export async function getRetention(): Promise<RetentionSetting> {
  const db = await getDB()
  const rec = await db.get('device_settings', RETENTION_KEY)
  if (!rec) return DEFAULT_RETENTION
  const v = rec.value as RetentionSetting | undefined
  if (!v || !v.mode) return DEFAULT_RETENTION
  return v
}

export async function setRetention(value: RetentionSetting): Promise<void> {
  const db = await getDB()
  await db.put('device_settings', { key: RETENTION_KEY, value })
}
