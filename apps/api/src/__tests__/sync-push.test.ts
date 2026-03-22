import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";

// NOTE: These tests require a valid Supabase Auth JWT token.
// They need a running Supabase instance with data.
// Set SUPABASE_TEST_TOKEN env var to a valid worker JWT.
let app: FastifyInstance;
let workerToken: string;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();

  workerToken = process.env.SUPABASE_TEST_TOKEN ?? "";
  if (!workerToken) {
    console.warn("SUPABASE_TEST_TOKEN not set — sync tests will be skipped");
    return;
  }

  // Get a project ID from dictionaries
  const dictRes = await app.inject({
    method: "GET",
    url: "/api/dictionaries",
    headers: { Authorization: `Bearer ${workerToken}` },
  });
  const dicts = JSON.parse(dictRes.body);
  projectId = dicts.projects[0]?.id;

  if (!projectId) {
    throw new Error("No projects found — create projects via admin panel first");
  }
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/sync/push — idempotent push", () => {
  const reportClientId = randomUUID();

  it("should create a report on first push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: { Authorization: `Bearer ${workerToken}` },
      payload: {
        reports: [
          {
            clientId: reportClientId,
            projectId,
            dateTime: new Date().toISOString(),
            workTypes: ["Кладка"],
            contractor: "ООО СтройМастер",
            ownForces: "",
            description: "Тестовый отчёт",
            photos: [],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe("created");
    expect(body.results[0].serverId).toBeDefined();
    expect(body.results[0].clientId).toBe(reportClientId);
  });

  it("should return 'exists' on duplicate push with same clientId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: { Authorization: `Bearer ${workerToken}` },
      payload: {
        reports: [
          {
            clientId: reportClientId,
            projectId,
            dateTime: new Date().toISOString(),
            workTypes: ["Кладка"],
            contractor: "ООО СтройМастер",
            ownForces: "",
            description: "Тестовый отчёт",
            photos: [],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe("exists");
    expect(body.results[0].serverId).toBeDefined();
  });

  it("should have only one report in DB for duplicate clientId", async () => {
    const { count } = await app.supabase
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("client_id", reportClientId);
    expect(count).toBe(1);
  });
});

describe("POST /api/sync/push — with photos", () => {
  const reportClientId = randomUUID();
  const photoClientId1 = randomUUID();
  const photoClientId2 = randomUUID();

  it("should return presigned URLs for photos", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: { Authorization: `Bearer ${workerToken}` },
      payload: {
        reports: [
          {
            clientId: reportClientId,
            projectId,
            dateTime: new Date().toISOString(),
            workTypes: ["Фундамент"],
            contractor: "ИП Петров",
            ownForces: "",
            description: "Отчёт с фотографиями",
            photos: [
              {
                clientId: photoClientId1,
                mimeType: "image/jpeg",
                fileName: "photo1.jpg",
                sizeBytes: 1024,
              },
              {
                clientId: photoClientId2,
                mimeType: "image/jpeg",
                fileName: "photo2.jpg",
                sizeBytes: 2048,
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results[0].status).toBe("created");
    expect(body.presignedUrls[photoClientId1]).toBeDefined();
    expect(body.presignedUrls[photoClientId2]).toBeDefined();
  });

  it("should have photos with PENDING_UPLOAD status", async () => {
    const { data: photos } = await app.supabase
      .from("photos")
      .select("*")
      .in("client_id", [photoClientId1, photoClientId2]);
    expect(photos).toHaveLength(2);
    expect(photos!.every((p) => p.upload_status === "PENDING_UPLOAD")).toBe(true);
  });

  it("should re-issue presigned URLs on duplicate push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sync/push",
      headers: { Authorization: `Bearer ${workerToken}` },
      payload: {
        reports: [
          {
            clientId: reportClientId,
            projectId,
            dateTime: new Date().toISOString(),
            workTypes: ["Фундамент"],
            contractor: "ИП Петров",
            ownForces: "",
            description: "Отчёт с фотографиями",
            photos: [
              {
                clientId: photoClientId1,
                mimeType: "image/jpeg",
                fileName: "photo1.jpg",
                sizeBytes: 1024,
              },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Report already exists
    expect(body.results[0].status).toBe("exists");
    // Still get presigned URL for pending photo
    expect(body.presignedUrls[photoClientId1]).toBeDefined();
  });
});

describe("GET /api/sync/pull — cursor-based", () => {
  it("should return reports without cursor (full pull)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sync/pull",
      headers: { Authorization: `Bearer ${workerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.reports)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
  });

  it("should return empty set with future cursor", async () => {
    const futureCursor = new Date(Date.now() + 86400000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/sync/pull?cursor=${futureCursor}`,
      headers: { Authorization: `Bearer ${workerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.reports).toHaveLength(0);
    expect(body.hasMore).toBe(false);
  });
});
