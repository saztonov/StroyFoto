import { getDB } from '@/lib/db'
import type { Profile } from '@/entities/profile/types'

const PROFILE_KEY = 'cached_profile'

export async function getCachedProfile(): Promise<Profile | null> {
  const db = await getDB()
  const rec = await db.get('device_settings', PROFILE_KEY)
  if (!rec) return null
  return rec.value as Profile | null
}

export async function setCachedProfile(profile: Profile): Promise<void> {
  const db = await getDB()
  await db.put('device_settings', { key: PROFILE_KEY, value: profile })
}

export async function clearCachedProfile(): Promise<void> {
  const db = await getDB()
  await db.delete('device_settings', PROFILE_KEY)
}
