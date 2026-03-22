import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import supabasePlugin from "./plugins/supabase.js";
import r2Plugin from "./plugins/r2.js";
import type { R2Service } from "./plugins/r2.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import reportsRoutes from "./routes/reports.js";
import photosRoutes from "./routes/photos.js";
import syncRoutes from "./routes/sync.js";
import adminRoutes from "./routes/admin.js";
import dictionariesRoutes from "./routes/dictionaries.js";
import uploadsRoutes from "./routes/uploads.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// Augment Fastify types
declare module "fastify" {
  interface FastifyInstance {
    supabase: SupabaseClient;
    r2: R2Service;
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; username: string; role: string };
    user: { sub: string; username: string; role: string; iat: number; exp: number };
  }
}

async function start() {
  const fastify = Fastify({
    logger: true,
  });

  // Register CORS
  await fastify.register(cors, { origin: true });

  // Register multipart support (15 MB file limit to match MAX_FILE_SIZE_BYTES)
  await fastify.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });

  // Register plugins
  await fastify.register(supabasePlugin);
  await fastify.register(r2Plugin);
  await fastify.register(authPlugin);

  // Register routes
  await fastify.register(authRoutes);
  await fastify.register(reportsRoutes);
  await fastify.register(photosRoutes);
  await fastify.register(syncRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(dictionariesRoutes);
  await fastify.register(uploadsRoutes);

  try {
    await fastify.listen({ port: config.API_PORT, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
