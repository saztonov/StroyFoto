import { db } from "./dexie";

/**
 * Estimate how much space can be freed by clearing blobs of synced photos.
 * Returns total bytes of blob data for photos with syncStatus === "synced".
 */
export async function estimateCleanableSpace(): Promise<number> {
  const syncedPhotos = await db.photos
    .where("syncStatus")
    .equals("synced")
    .toArray();

  let totalBytes = 0;
  for (const photo of syncedPhotos) {
    if (photo.blob && photo.blob.size > 0) {
      totalBytes += photo.blob.size;
    }
    if (photo.thumbnail && photo.thumbnail.size > 0) {
      totalBytes += photo.thumbnail.size;
    }
  }

  return totalBytes;
}

/**
 * Clear blob data for synced photos only.
 * NEVER touches unsynced photos. Keeps all metadata intact.
 * Returns the number of bytes freed.
 */
export async function cleanSyncedBlobData(): Promise<number> {
  const syncedPhotos = await db.photos
    .where("syncStatus")
    .equals("synced")
    .toArray();

  let freedBytes = 0;
  const emptyBlob = new Blob([], { type: "application/octet-stream" });

  for (const photo of syncedPhotos) {
    if (photo.blob && photo.blob.size > 0) {
      freedBytes += photo.blob.size;
    }
    if (photo.thumbnail && photo.thumbnail.size > 0) {
      freedBytes += photo.thumbnail.size;
    }

    await db.photos.update(photo.clientId, {
      blob: emptyBlob,
      thumbnail: emptyBlob,
    });
  }

  return freedBytes;
}

/** Count of synced photos that still have blob data */
export async function countCleanablePhotos(): Promise<number> {
  const syncedPhotos = await db.photos
    .where("syncStatus")
    .equals("synced")
    .toArray();

  return syncedPhotos.filter((p) => p.blob && p.blob.size > 0).length;
}
