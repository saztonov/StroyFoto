import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import supabasePlugin from "./plugins/supabase.js";
import r2Plugin from "./plugins/r2.js";
import type { R2Service } from "./plugins/r2.js";
import authPlugin from "./plugins/auth.js";
import type { AuthUser } from "./plugins/auth.js";
import profileRoutes from "./routes/profile.js";
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

  interface FastifyRequest {
    user: AuthUser;
  }
}

async function start() {
  const fastify = Fastify({
    logger: true,
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  });

  // Register sensible (httpErrors helper)
  await fastify.register(sensible);

  // Register multipart support (15 MB file limit to match MAX_FILE_SIZE_BYTES)
  await fastify.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });

  // Register plugins
  await fastify.register(supabasePlugin);
  await fastify.register(r2Plugin);
  await fastify.register(authPlugin);

  // Custom error handler to include `code` in error responses
  fastify.setErrorHandler((err: Error & { statusCode?: number; code?: string }, _request, reply) => {
    const statusCode = err.statusCode ?? 500;
    const response: Record<string, unknown> = {
      statusCode,
      error: err.name,
      message: err.message,
    };
    if (err.code) {
      response.code = err.code;
    }
    reply.status(statusCode).send(response);
  });

  // Register routes
  await fastify.register(profileRoutes);
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
