import { db, getCurrentProfileId } from "./dexie";
import { handleAuthError } from "../api/token-helper";

/**
 * Pull reports from server into Dexie (IndexedDB) using cursor-based /api/sync/pull.
 * Upserts existing reports (not just inserts new ones).
 * Photo metadata inserted with empty blobs (detail page fetches on-demand).
 */
export async function pullRemoteReports(
  token: string,
  apiUrl: string,
): Promise<number> {
  let currentToken = token;
  const profileId = await getCurrentProfileId();
  let pulled = 0;
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);

    let res = await fetch(`${apiUrl}/api/sync/pull?${params}`, {
      headers: { Authorization: `Bearer ${currentToken}` },
    });

    if (res.status === 401) {
      const newToken = await handleAuthError();
      if (!newToken) break; // Session expired — stop pulling
      currentToken = newToken;
      res = await fetch(`${apiUrl}/api/sync/pull?${params}`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
    }

    if (!res.ok) break;

    const body: {
      reports: Array<Record<string, unknown>>;
      nextCursor: string | null;
      hasMore: boolean;
    } = await res.json();

    if (!body.reports || body.reports.length === 0) break;

    // Build sets of existing local identifiers for dedup
    const localReports = await db.reports.toArray();
    const localClientIds = new Set(localReports.map((r) => r.clientId));
    const localServerIds = new Set(
      localReports.map((r) => r.serverId).filter(Boolean),
    );

    const localPhotos = await db.photos.toArray();
    const localPhotoClientIds = new Set(localPhotos.map((p) => p.clientId));

    for (const sr of body.reports) {
      try {
        const clientId = sr.clientId as string;
        const serverId = sr.id as string;

        const reportData = {
          clientId,
          serverId,
          projectId: sr.projectId as string,
          dateTime: new Date(sr.dateTime as string),
          workTypes: (sr.workTypes as string[]) ?? [],
          contractor: (sr.contractor as string) ?? "",
          ownForces: (sr.ownForces as string) ?? "",
          description: (sr.description as string) ?? "",
          userId: (sr.userId as string) ?? "",
          scopeProfileId: profileId,
          syncStatus: "synced" as const,
          createdAt: sr.createdAt ? new Date(sr.createdAt as string) : new Date(),
          updatedAt: sr.updatedAt ? new Date(sr.updatedAt as string) : new Date(),
        };

        if (localClientIds.has(clientId) || localServerIds.has(serverId)) {
          // Upsert: update existing report with server data
          const existing = localClientIds.has(clientId)
            ? await db.reports.get(clientId)
            : await db.reports.where("serverId").equals(serverId).first();

          if (existing) {
            // Only update if the report is already synced (don't overwrite local changes)
            if (existing.syncStatus === "synced") {
              await db.reports.update(existing.clientId, {
                ...reportData,
                clientId: existing.clientId, // keep original clientId
              });
            }
          }
        } else {
          // New report: insert
          await db.reports.add(reportData);
          localClientIds.add(clientId);
          localServerIds.add(serverId);
        }

        // Insert photo metadata (no blobs)
        const photos = sr.photos as Array<Record<string, unknown>> | undefined;
        if (photos && photos.length > 0) {
          for (const photo of photos) {
            const photoClientId = photo.clientId as string;
            if (localPhotoClientIds.has(photoClientId)) continue;

            const objectKey = (photo.objectKey as string) ?? "";
            const fileName = objectKey.split("/").pop() ?? "photo.jpg";

            await db.photos.add({
              clientId: photoClientId,
              serverId: photo.id as string,
              reportClientId: clientId,
              blob: new Blob([]),
              mimeType: (photo.mimeType as string) ?? "image/jpeg",
              fileName,
              size: photo.sizeBytes as number | undefined,
              syncStatus: "synced",
              localStatus: "synced",
              scopeProfileId: profileId,
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

    cursor = body.nextCursor;
    hasMore = body.hasMore && cursor !== null;
  }

  if (pulled > 0) {
    await db.syncMeta.put({
      key: "lastPullTime",
      value: new Date().toISOString(),
    });
  }

  return pulled;
}
