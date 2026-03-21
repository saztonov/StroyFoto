import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/auth/login", () => {
  it("should return accessToken, refreshToken, and backward-compat token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "worker", password: "worker123" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.token).toBe(body.accessToken);
    expect(body.user.username).toBe("worker");
    expect(body.user.role).toBe("WORKER");
  });

  it("should reject invalid credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "worker", password: "wrong" },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/auth/refresh", () => {
  let refreshToken: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "admin123" },
    });
    const body = JSON.parse(res.body);
    refreshToken = body.refreshToken;
  });

  it("should return new tokens on valid refresh", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    // New refresh token should differ (rotation)
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it("should reject reuse of rotated refresh token", async () => {
    // The old refreshToken was deleted during rotation
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(401);
  });

  it("should reject invalid refresh token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/refresh",
      payload: { refreshToken: "totally-invalid-token" },
    });

    expect(res.statusCode).toBe(401);
  });
});
