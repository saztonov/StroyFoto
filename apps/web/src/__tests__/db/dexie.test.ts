import { describe, it, expect, beforeEach } from "vitest";
import Dexie from "dexie";
import { db } from "../../db/dexie";
import type { LocalReport, LocalPhoto } from "../../db/dexie";

// Reset DB between tests
beforeEach(async () => {
  await db.reports.clear();
  await db.photos.clear();
  await db.syncQueue.clear();
  await db.projects.clear();
  await db.workTypes.clear();
  await db.contractors.clear();
  await db.ownForces.clear();
  await db.syncState.clear();
  await db.appSettings.clear();
});

function makeReport(overrides: Partial<LocalReport> = {}): LocalReport {
  return {
    clientId: crypto.randomUUID(),
    projectId: "proj-1",
    dateTime: new Date("2025-01-15T10:00:00"),
    workTypes: ["Монолит"],
    contractor: "ООО Строй",
    ownForces: "",
    description: "Тестовый отчёт",
    userId: "user-1",
    scopeProfileId: "user-1",
    syncStatus: "local-only",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Dexie schema v6", () => {
  it("has all expected tables", () => {
    const tableNames = db.tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      "appSettings",
      "authSession",
      "contractors",
      "ownForces",
      "photos",
      "projects",
      "reports",
      "syncMeta",
      "syncQueue",
      "syncState",
      "workTypes",
    ]);
  });
});

describe("Reports CRUD", () => {
  it("creates and reads a report", async () => {
    const report = makeReport();
    await db.reports.add(report);

    const fetched = await db.reports.get(report.clientId);
    expect(fetched).toBeDefined();
    expect(fetched!.projectId).toBe("proj-1");
    expect(fetched!.workTypes).toEqual(["Монолит"]);
    expect(fetched!.syncStatus).toBe("local-only");
  });

  it("updates a report", async () => {
    const report = makeReport();
    await db.reports.add(report);

    await db.reports.update(report.clientId, { syncStatus: "synced" });
    const updated = await db.reports.get(report.clientId);
    expect(updated!.syncStatus).toBe("synced");
  });

  it("deletes a report", async () => {
    const report = makeReport();
    await db.reports.add(report);

    await db.reports.delete(report.clientId);
    const deleted = await db.reports.get(report.clientId);
    expect(deleted).toBeUndefined();
  });

  it("queries reports by syncStatus index", async () => {
    await db.reports.bulkAdd([
      makeReport({ syncStatus: "local-only" }),
      makeReport({ syncStatus: "synced" }),
      makeReport({ syncStatus: "error" }),
      makeReport({ syncStatus: "draft" }),
    ]);

    const pending = await db.reports
      .where("syncStatus")
      .anyOf(["local-only", "queued", "syncing", "error"])
      .toArray();

    expect(pending).toHaveLength(2);
  });
});

describe("Photos CRUD", () => {
  it("stores and retrieves a photo with Blob", async () => {
    const blobContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const blob = new Blob([blobContent], { type: "image/png" });
    const thumbnail = new Blob([new Uint8Array([0xff])], { type: "image/jpeg" });

    const photo: LocalPhoto = {
      clientId: crypto.randomUUID(),
      reportClientId: "report-1",
      blob,
      thumbnail,
      mimeType: "image/png",
      fileName: "test.png",
      size: blob.size,
      hash: "abc123",
      localStatus: "ready",
      syncStatus: "pending",
      scopeProfileId: "user-1",
      createdAt: new Date(),
    };

    await db.photos.add(photo);
    const fetched = await db.photos.get(photo.clientId);

    expect(fetched).toBeDefined();
    // fake-indexeddb may not preserve Blob prototype, so check it's truthy and has size
    expect(fetched!.blob).toBeTruthy();
    expect(fetched!.thumbnail).toBeTruthy();
    expect(fetched!.size).toBe(blob.size);
    expect(fetched!.hash).toBe("abc123");
    expect(fetched!.localStatus).toBe("ready");
  });

  it("queries photos by reportClientId", async () => {
    const reportId = "report-abc";
    const makePhoto = () => ({
      clientId: crypto.randomUUID(),
      reportClientId: reportId,
      blob: new Blob(["photo"]),
      mimeType: "image/jpeg",
      fileName: "p.jpg",
      syncStatus: "pending" as const,
      scopeProfileId: "user-1",
      createdAt: new Date(),
    });

    await db.photos.bulkAdd([makePhoto(), makePhoto(), makePhoto()]);

    const photos = await db.photos
      .where("reportClientId")
      .equals(reportId)
      .toArray();

    expect(photos).toHaveLength(3);
  });
});

describe("Reference tables", () => {
  it("CRUD for projects", async () => {
    await db.projects.add({
      id: "p1",
      name: "Проект Альфа",
      code: "ALFA",
      scopeProfileId: "user-1",
      updatedAt: new Date(),
    });

    const p = await db.projects.get("p1");
    expect(p!.name).toBe("Проект Альфа");
    expect(p!.code).toBe("ALFA");
  });

  it("CRUD for workTypes", async () => {
    await db.workTypes.add({ id: "wt1", name: "Монолит", scopeProfileId: "user-1", updatedAt: new Date() });
    const wt = await db.workTypes.get("wt1");
    expect(wt!.name).toBe("Монолит");
  });

  it("CRUD for contractors", async () => {
    await db.contractors.add({ id: "c1", name: "ООО Строй", scopeProfileId: "user-1", updatedAt: new Date() });
    const c = await db.contractors.get("c1");
    expect(c!.name).toBe("ООО Строй");
  });

  it("CRUD for ownForces", async () => {
    await db.ownForces.add({ id: "of1", name: "Бригада 1", scopeProfileId: "user-1", updatedAt: new Date() });
    const of = await db.ownForces.get("of1");
    expect(of!.name).toBe("Бригада 1");
  });

  it("CRUD for syncState", async () => {
    await db.syncState.put({ entityType: "projects", lastSyncedAt: new Date() });
    const s = await db.syncState.get("projects");
    expect(s!.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("CRUD for appSettings", async () => {
    await db.appSettings.put({ key: "theme", value: "dark" });
    const s = await db.appSettings.get("theme");
    expect(s!.value).toBe("dark");
  });
});

describe("Autosave draft", () => {
  it("put() creates or updates (upsert) a draft report", async () => {
    const clientId = crypto.randomUUID();
    const base = makeReport({ clientId, syncStatus: "draft", description: "v1" });

    await db.reports.put(base);
    expect(await db.reports.count()).toBe(1);

    await db.reports.put({ ...base, description: "v2", updatedAt: new Date() });
    expect(await db.reports.count()).toBe(1);

    const latest = await db.reports.get(clientId);
    expect(latest!.description).toBe("v2");
    expect(latest!.syncStatus).toBe("draft");
  });
});

describe("Persistence across re-import", () => {
  it("report survives when db reference is re-obtained", async () => {
    const report = makeReport();
    await db.reports.add(report);

    // Re-open the same Dexie database (simulates page reload)
    const db2 = new Dexie("stroyfoto");
    db2.version(8).stores({
      reports: "clientId, serverId, projectId, userId, scopeProfileId, syncStatus, dateTime",
      photos: "clientId, serverId, reportClientId, scopeProfileId, syncStatus, localStatus",
      syncQueue: "++id, operationType, entityClientId, scopeProfileId, status, [operationType+entityClientId+status], nextRetryAt, createdAt",
      authSession: "id",
      projects: "id, code, name, scopeProfileId",
      workTypes: "id, name, scopeProfileId",
      contractors: "id, name, scopeProfileId",
      ownForces: "id, name, scopeProfileId",
      syncState: "entityType",
      appSettings: "key",
      syncMeta: "key",
    });

    const fetched = await db2.table("reports").get(report.clientId);
    expect(fetched).toBeDefined();
    expect(fetched.projectId).toBe(report.projectId);
    expect(fetched.syncStatus).toBe("local-only");

    db2.close();
  });
});
