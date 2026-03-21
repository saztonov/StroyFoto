import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import prismaPlugin from "../plugins/prisma.js";
import minioPlugin from "../plugins/minio.js";
import authPlugin from "../plugins/auth.js";
import authRoutes from "../routes/auth.js";
import reportsRoutes from "../routes/reports.js";
import photosRoutes from "../routes/photos.js";
import syncRoutes from "../routes/sync.js";
import adminRoutes from "../routes/admin.js";
import dictionariesRoutes from "../routes/dictionaries.js";
import uploadsRoutes from "../routes/uploads.js";
import type { PrismaClient } from "@prisma/client";
import type { Client as MinioClient } from "minio";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    minio: MinioClient;
    authenticate: (request: import("fastify").FastifyRequest) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; username: string; role: string };
    user: { sub: string; username: string; role: string; iat: number; exp: number };
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(multipart);
  await app.register(prismaPlugin);
  await app.register(minioPlugin);
  await app.register(authPlugin);

  await app.register(authRoutes);
  await app.register(reportsRoutes);
  await app.register(photosRoutes);
  await app.register(syncRoutes);
  await app.register(adminRoutes);
  await app.register(dictionariesRoutes);
  await app.register(uploadsRoutes);

  await app.ready();
  return app;
}

export async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  const body = JSON.parse(res.body);
  return { accessToken: body.accessToken ?? body.token, refreshToken: body.refreshToken };
}
