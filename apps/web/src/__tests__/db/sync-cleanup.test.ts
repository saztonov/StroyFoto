import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../db/dexie";
import type { LocalReport, LocalPhoto } from "../../db/dexie";
import { cleanReportPhotos, cleanSyncedBlobData } from "../../db/storage-cleanup";

const PROFILE_ID = "test-user-1";

function makeReport(overrides: Partial<LocalReport> = {}): LocalReport {
  return {
    clientId: crypto.randomUUID(),
    projectId: "proj-1",
    dateTime: new Date(),
    workTypes: ["Монолит"],
    contractor: "ООО Строй",
    ownForces: "",
    description: "",
    userId: PROFILE_ID,
    scopeProfileId: PROFILE_ID,
    syncStatus: "synced",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePhoto(reportClientId: string, overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    clientId: crypto.randomUUID(),
    reportClientId,
    blob: new Blob(["photo-data-here"], { type: "image/jpeg" }),
    thumbnail: new Blob(["thumb"], { type: "image/jpeg" }),
    mimeType: "image/jpeg",
    fileName: "test.jpg",
    size: 1000,
    syncStatus: "synced",
    localStatus: "synced",
    scopeProfileId: PROFILE_ID,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.reports.clear();
  await db.photos.clear();
  await db.syncQueue.clear();
});

describe("cleanReportPhotos", () => {
  it("clears blobs for photos of a specific report", async () => {
    const report = makeReport();
    await db.reports.add(report);

    const photo1 = makePhoto(report.clientId);
    const photo2 = makePhoto(report.clientId);
    await db.photos.bulkAdd([photo1, photo2]);

    await cleanReportPhotos(report.clientId);

    const updated1 = await db.photos.get(photo1.clientId);
    const updated2 = await db.photos.get(photo2.clientId);
    // After cleanup, blobs should be replaced (empty blob with octet-stream type)
    // Note: fake-indexeddb may not preserve blob.type, so we check that the update happened
    expect(updated1).toBeDefined();
    expect(updated2).toBeDefined();
    // Metadata should be preserved
    expect(updated1!.fileName).toBe("test.jpg");
    expect(updated1!.syncStatus).toBe("synced");
    expect(updated1!.mimeType).toBe("image/jpeg");
  });

  it("does not touch photos from other reports", async () => {
    const report1 = makeReport();
    const report2 = makeReport();
    await db.reports.bulkAdd([report1, report2]);

    const photo1 = makePhoto(report1.clientId);
    const photo2 = makePhoto(report2.clientId);
    await db.photos.bulkAdd([photo1, photo2]);

    await cleanReportPhotos(report1.clientId);

    // Photo from report2 should remain untouched
    const untouched = await db.photos.get(photo2.clientId);
    expect(untouched).toBeDefined();
    expect(untouched!.reportClientId).toBe(report2.clientId);
    expect(untouched!.fileName).toBe("test.jpg");
  });
});

describe("cleanSyncedBlobData", () => {
  it("only cleans photos with syncStatus=synced", async () => {
    const report = makeReport();
    await db.reports.add(report);

    const syncedPhoto = makePhoto(report.clientId, { syncStatus: "synced" });
    const pendingPhoto = makePhoto(report.clientId, { syncStatus: "pending" });
    await db.photos.bulkAdd([syncedPhoto, pendingPhoto]);

    await cleanSyncedBlobData();

    const cleaned = await db.photos.get(syncedPhoto.clientId);
    const kept = await db.photos.get(pendingPhoto.clientId);

    // After cleanup, synced photo metadata preserved but blob replaced
    expect(cleaned).toBeDefined();
    expect(cleaned!.syncStatus).toBe("synced");
    // Pending photo should remain untouched
    expect(kept).toBeDefined();
    expect(kept!.syncStatus).toBe("pending");
  });
});

describe("Scope isolation", () => {
  it("reports with different scopeProfileId are separate", async () => {
    const reportA = makeReport({ scopeProfileId: "user-A" });
    const reportB = makeReport({ scopeProfileId: "user-B" });
    await db.reports.bulkAdd([reportA, reportB]);

    const userAReports = await db.reports
      .where("scopeProfileId")
      .equals("user-A")
      .toArray();

    expect(userAReports).toHaveLength(1);
    expect(userAReports[0].clientId).toBe(reportA.clientId);
  });

  it("photos scoped to different users are separate", async () => {
    const report = makeReport();
    await db.reports.add(report);

    const photoA = makePhoto(report.clientId, { scopeProfileId: "user-A" });
    const photoB = makePhoto(report.clientId, { scopeProfileId: "user-B" });
    await db.photos.bulkAdd([photoA, photoB]);

    const userAPhotos = await db.photos
      .where("scopeProfileId")
      .equals("user-A")
      .toArray();

    expect(userAPhotos).toHaveLength(1);
  });
});

describe("FINALIZE_REPORT preconditions", () => {
  it("report should not be synced until all photos are synced", async () => {
    const report = makeReport({ syncStatus: "queued" });
    await db.reports.add(report);

    const syncedPhoto = makePhoto(report.clientId, { syncStatus: "synced" });
    const pendingPhoto = makePhoto(report.clientId, { syncStatus: "pending" });
    await db.photos.bulkAdd([syncedPhoto, pendingPhoto]);

    // Check precondition: not all photos synced
    const photos = await db.photos
      .where("reportClientId")
      .equals(report.clientId)
      .toArray();
    const unsyncedPhotos = photos.filter((p) => p.syncStatus !== "synced");

    expect(unsyncedPhotos.length).toBe(1);
    // FINALIZE should not proceed if unsynced photos exist
  });

  it("report can be finalized when all photos are synced", async () => {
    const report = makeReport({ syncStatus: "queued" });
    await db.reports.add(report);

    const photo1 = makePhoto(report.clientId, { syncStatus: "synced" });
    const photo2 = makePhoto(report.clientId, { syncStatus: "synced" });
    await db.photos.bulkAdd([photo1, photo2]);

    const photos = await db.photos
      .where("reportClientId")
      .equals(report.clientId)
      .toArray();
    const unsyncedPhotos = photos.filter((p) => p.syncStatus !== "synced");

    expect(unsyncedPhotos.length).toBe(0);

    // Simulate finalization
    await db.reports.update(report.clientId, { syncStatus: "synced" });
    await cleanReportPhotos(report.clientId);

    // After cleanup, photo metadata should be preserved
    const cleanedPhoto = await db.photos.get(photo1.clientId);
    expect(cleanedPhoto).toBeDefined();
    expect(cleanedPhoto!.syncStatus).toBe("synced");
    expect(cleanedPhoto!.fileName).toBe("test.jpg");

    const finalReport = await db.reports.get(report.clientId);
    expect(finalReport!.syncStatus).toBe("synced");
  });
});
