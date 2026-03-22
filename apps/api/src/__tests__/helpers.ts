import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import supabasePlugin from "../plugins/supabase.js";
import authPlugin from "../plugins/auth.js";
import type { AuthUser } from "../plugins/auth.js";
import profileRoutes from "../routes/profile.js";
import reportsRoutes from "../routes/reports.js";
import photosRoutes from "../routes/photos.js";
import syncRoutes from "../routes/sync.js";
import adminRoutes from "../routes/admin.js";
import dictionariesRoutes from "../routes/dictionaries.js";
import uploadsRoutes from "../routes/uploads.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { R2Service } from "../plugins/r2.js";

declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient;
    r2: R2Service;
    authenticate: (request: import("fastify").FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    user: AuthUser;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  await app.register(multipart);
  await app.register(supabasePlugin);
  await app.register(authPlugin);

  await app.register(profileRoutes);
  await app.register(reportsRoutes);
  await app.register(photosRoutes);
  await app.register(syncRoutes);
  await app.register(adminRoutes);
  await app.register(dictionariesRoutes);
  await app.register(uploadsRoutes);

  await app.ready();
  return app;
}
