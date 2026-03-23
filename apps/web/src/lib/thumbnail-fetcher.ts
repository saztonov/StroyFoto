import type { LocalPhoto } from "../db/dexie";
import { getValidToken } from "../api/token-helper";
import { generateThumbnail } from "./image-processing";

const BASE_URL = import.meta.env.VITE_API_URL ?? "";
const CONCURRENCY = 3;

const inFlight = new Set<string>();
const failed = new Set<string>();

// Reset failed set when coming back online so thumbnails are retried
if (typeof window !== "undefined") {
  window.addEventListener("online", () => failed.clear());
}

export function fetchAndCacheThumbnails(photos: LocalPhoto[]): void {
  const eligible = photos.filter(
    (p) =>
      p.serverId &&
      !(p.thumbnail?.size) &&
      !(p.blob?.size) &&
      !inFlight.has(p.clientId) &&
      !failed.has(p.clientId),
  );

  const slots = CONCURRENCY - inFlight.size;
  if (slots <= 0) return;

  for (const photo of eligible.slice(0, slots)) {
    fetchSingleThumbnail(photo);
  }
}

async function fetchSingleThumbnail(photo: LocalPhoto): Promise<void> {
  inFlight.add(photo.clientId);
  try {
    const token = await getValidToken();
    if (!token) {
      failed.add(photo.clientId);
      return;
    }

    const res = await fetch(`${BASE_URL}/api/photos/${photo.serverId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      failed.add(photo.clientId);
      return;
    }

    const fullBlob = await res.blob();
    const thumbnail = await generateThumbnail(fullBlob, 200);

    const { db } = await import("../db/dexie");
    await db.photos.update(photo.clientId, { thumbnail });
  } catch {
    failed.add(photo.clientId);
  } finally {
    inFlight.delete(photo.clientId);
  }
}
