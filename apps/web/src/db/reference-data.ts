import { REFERENCE_DATA_TTL_MS } from "@stroyfoto/shared";
import { db, getCurrentProfileId } from "./dexie";

export async function syncReferenceData(
  token: string,
  apiUrl: string,
): Promise<void> {
  const profileId = await getCurrentProfileId();

  const endpoints = [
    { key: "projects", table: db.projects },
    { key: "workTypes", table: db.workTypes },
    { key: "contractors", table: db.contractors },
    { key: "ownForces", table: db.ownForces },
  ] as const;

  for (const { key, table } of endpoints) {
    try {
      const syncState = await db.syncState.get(key);

      // Count only records belonging to current user scope
      const scopedCount = profileId
        ? await (table as unknown as { where: (idx: string) => { equals: (v: string) => { count: () => Promise<number> } } })
            .where("scopeProfileId")
            .equals(profileId)
            .count()
        : await (table as unknown as { count: () => Promise<number> }).count();

      // Skip fetch if data was synced recently (within TTL) AND table has scoped data
      if (syncState?.lastSyncedAt) {
        const elapsed = Date.now() - syncState.lastSyncedAt.getTime();
        if (elapsed < REFERENCE_DATA_TTL_MS && scopedCount > 0) continue;
      }

      // Always do full fetch (not incremental) to ensure clean scope
      const url = `${apiUrl}/api/reference/${key}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) continue;

      const data = await res.json();
      if (Array.isArray(data)) {
        // Full replace: clear old scoped data, then insert fresh
        if (profileId) {
          await (table as unknown as { where: (idx: string) => { equals: (v: string) => { delete: () => Promise<number> } } })
            .where("scopeProfileId")
            .equals(profileId)
            .delete();
        } else {
          await (table as unknown as { clear: () => Promise<void> }).clear();
        }

        if (data.length > 0) {
          const scopedData = data.map((item: Record<string, unknown>) => ({
            ...item,
            scopeProfileId: profileId,
          }));
          await (table as unknown as { bulkPut: (items: unknown[]) => Promise<void> }).bulkPut(scopedData);
        }
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
  const keys = ["projects", "workTypes", "contractors", "ownForces"];
  for (const key of keys) {
    const syncState = await db.syncState.get(key);
    if (!syncState?.lastSyncedAt) return true;
    const elapsed = Date.now() - syncState.lastSyncedAt.getTime();
    if (elapsed >= REFERENCE_DATA_TTL_MS) return true;
  }
  return false;
}

/** Invalidate cached reference data for an entity type, triggering immediate re-sync */
export async function invalidateReferenceCache(entityType: string): Promise<void> {
  await db.syncState.delete(entityType);
  window.dispatchEvent(new CustomEvent("reference-data-invalidated"));
}
