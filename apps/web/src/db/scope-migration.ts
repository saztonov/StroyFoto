import { db } from "./dexie";

/**
 * Post-login cleanup: remove synced data from other users, reset reference data.
 * Preserves unsynced reports/photos/queue of the current user.
 * Called once after successful login/profile fetch.
 */
export async function cleanScopedCacheOnLogin(profileId: string): Promise<void> {
  // 1. Delete synced reports belonging to other users
  const otherSyncedReports = await db.reports
    .filter((r) => r.scopeProfileId !== profileId && r.syncStatus === "synced")
    .toArray();

  for (const r of otherSyncedReports) {
    await db.photos.where("reportClientId").equals(r.clientId).delete();
    await db.reports.delete(r.clientId);
  }

  // 2. Delete synced photos orphaned from other users
  const otherSyncedPhotos = await db.photos
    .filter((p) => p.scopeProfileId !== profileId && p.syncStatus === "synced")
    .toArray();

  for (const p of otherSyncedPhotos) {
    await db.photos.delete(p.clientId);
  }

  // 3. Delete queue entries from other users
  const otherQueueEntries = await db.syncQueue
    .filter((e) => e.scopeProfileId !== profileId)
    .toArray();

  for (const e of otherQueueEntries) {
    if (e.id) await db.syncQueue.delete(e.id);
  }

  // 4. Clear reference data — will be re-fetched with correct scope on next sync
  await db.projects.clear();
  await db.workTypes.clear();
  await db.contractors.clear();
  await db.ownForces.clear();
  await db.syncState.clear();
}
