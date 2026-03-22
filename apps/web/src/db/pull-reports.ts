import { db } from "./dexie";

/**
 * Pull reports from server into Dexie (IndexedDB).
 * Fetches reports that exist on the server but not locally,
 * including their photo metadata.
 */
export async function pullRemoteReports(
  token: string,
  apiUrl: string,
): Promise<number> {
  // 1. Fetch server reports list
  const res = await fetch(`${apiUrl}/api/reports`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return 0;

  const serverReports: Array<Record<string, unknown>> = await res.json();
  if (!Array.isArray(serverReports) || serverReports.length === 0) return 0;

  // 2. Build sets of existing local identifiers
  const localReports = await db.reports.toArray();
  const localClientIds = new Set(localReports.map((r) => r.clientId));
  const localServerIds = new Set(
    localReports.map((r) => r.serverId).filter(Boolean),
  );

  // Also build a set of existing photo clientIds to avoid duplicates
  const localPhotos = await db.photos.toArray();
  const localPhotoClientIds = new Set(localPhotos.map((p) => p.clientId));

  // 3. Find new reports (not in Dexie by clientId or serverId)
  const newReports = serverReports.filter(
    (sr) =>
      !localClientIds.has(sr.clientId as string) &&
      !localServerIds.has(sr.id as string),
  );

  if (newReports.length === 0) return 0;

  let pulled = 0;

  for (const sr of newReports) {
    try {
      // Fetch full report with photos
      const detailRes = await fetch(`${apiUrl}/api/reports/${sr.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!detailRes.ok) continue;

      const detail: Record<string, unknown> = await detailRes.json();

      // Insert report into Dexie
      await db.reports.add({
        clientId: detail.clientId as string,
        serverId: detail.id as string,
        projectId: detail.projectId as string,
        dateTime: new Date(detail.dateTime as string),
        workTypes: (detail.workTypes as string[]) ?? [],
        contractor: (detail.contractor as string) ?? "",
        ownForces: (detail.ownForces as string) ?? "",
        description: (detail.description as string) ?? "",
        userId: (detail.userId as string) ?? "",
        syncStatus: "synced",
        createdAt: detail.createdAt ? new Date(detail.createdAt as string) : new Date(),
        updatedAt: detail.updatedAt ? new Date(detail.updatedAt as string) : new Date(),
      });

      // Insert photo metadata (no blobs — detail page fetches via serverId)
      const photos = detail.photos as Array<Record<string, unknown>> | undefined;
      if (photos && photos.length > 0) {
        for (const photo of photos) {
          const photoClientId = photo.clientId as string;
          if (localPhotoClientIds.has(photoClientId)) continue;

          const objectKey = (photo.objectKey as string) ?? "";
          const fileName = objectKey.split("/").pop() ?? "photo.jpg";

          await db.photos.add({
            clientId: photoClientId,
            serverId: photo.id as string,
            reportClientId: detail.clientId as string,
            blob: new Blob([]),
            mimeType: (photo.mimeType as string) ?? "image/jpeg",
            fileName,
            size: photo.sizeBytes as number | undefined,
            syncStatus: "synced",
            localStatus: "synced",
            createdAt: new Date(),
          });

          localPhotoClientIds.add(photoClientId);
        }
      }

      pulled++;
    } catch {
      // Skip individual report errors, continue with next
    }
  }

  if (pulled > 0) {
    await db.syncMeta.put({
      key: "lastPullTime",
      value: new Date().toISOString(),
    });
  }

  return pulled;
}
