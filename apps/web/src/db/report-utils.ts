import { db } from "./dexie";
import { enqueueSyncOp } from "./sync-queue";

/**
 * Delete a report locally: remove sync queue entries, photos, and the report itself.
 */
export async function deleteLocalReport(reportClientId: string) {
  const photos = await db.photos.where("reportClientId").equals(reportClientId).toArray();
  const photoClientIds = photos.map((p) => p.clientId);

  // Delete queue entries for the report
  await db.syncQueue.where("entityClientId").equals(reportClientId).delete();

  // Delete queue entries for each photo
  for (const photoClientId of photoClientIds) {
    await db.syncQueue.where("entityClientId").equals(photoClientId).delete();
  }

  // Delete photos and report from Dexie
  await db.photos.where("reportClientId").equals(reportClientId).delete();
  await db.reports.delete(reportClientId);
}

/**
 * Full report deletion: deletes locally and enqueues DELETE_REPORT
 * for server-side deletion if the report was already synced.
 */
export async function deleteReportFull(reportClientId: string) {
  const report = await db.reports.get(reportClientId);
  const serverId = report?.serverId;

  // Clean up local data
  await deleteLocalReport(reportClientId);

  // If it was synced to the server, enqueue a delete operation
  if (serverId) {
    await enqueueSyncOp("DELETE_REPORT", reportClientId, { serverId });
  }
}
