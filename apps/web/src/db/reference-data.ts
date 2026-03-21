import { WORK_TYPES, REFERENCE_DATA_TTL_MS } from "@stroyfoto/shared";
import { db } from "./dexie";

export async function syncReferenceData(
  token: string,
  apiUrl: string,
): Promise<void> {
  const endpoints = [
    { key: "projects", table: db.projects },
    { key: "workTypes", table: db.workTypes },
    { key: "contractors", table: db.contractors },
    { key: "areas", table: db.areas },
  ] as const;

  for (const { key, table } of endpoints) {
    try {
      const syncState = await db.syncState.get(key);

      // Skip fetch if data was synced recently (within TTL)
      if (syncState?.lastSyncedAt) {
        const elapsed = Date.now() - syncState.lastSyncedAt.getTime();
        if (elapsed < REFERENCE_DATA_TTL_MS) continue;
      }

      const since = syncState?.lastSyncedAt?.toISOString() ?? "";
      const url = `${apiUrl}/api/reference/${key}${since ? `?updatedSince=${since}` : ""}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) continue;

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        await (table as unknown as { bulkPut: (items: unknown[]) => Promise<void> }).bulkPut(data);
      }
      // Always update lastSyncedAt on successful fetch (even if no new data)
      await db.syncState.put({
        entityType: key,
        lastSyncedAt: new Date(),
      });
    } catch {
      // silently fail — use cached data
    }
  }
}

/** Check if any reference data table has stale cache (older than TTL) */
export async function isReferenceDataStale(): Promise<boolean> {
  const keys = ["projects", "workTypes", "contractors", "areas"];
  for (const key of keys) {
    const syncState = await db.syncState.get(key);
    if (!syncState?.lastSyncedAt) return true;
    const elapsed = Date.now() - syncState.lastSyncedAt.getTime();
    if (elapsed >= REFERENCE_DATA_TTL_MS) return true;
  }
  return false;
}

export async function ensureDefaultWorkTypes(): Promise<void> {
  const count = await db.workTypes.count();
  if (count > 0) return;

  const now = new Date();
  await db.workTypes.bulkAdd(
    WORK_TYPES.map((name, i) => ({
      id: `default-wt-${i}`,
      name,
      updatedAt: now,
    })),
  );
}
