import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  app_metadata?: { app_role?: string };
  aud?: string;
  role?: string;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  /** auth.users.id */
  authId: string;
  /** profiles.id (resolved via get-profile utility) */
  profileId: string;
  role: "ADMIN" | "WORKER";
  email: string;
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw fastify.httpErrors.unauthorized("Missing or invalid authorization header");
    }

    const token = authHeader.slice(7);

    let payload: SupabaseJwtPayload;
    try {
      payload = jwt.verify(token, config.SUPABASE_JWT_SECRET, {
        algorithms: ["HS256"],
      }) as SupabaseJwtPayload;
    } catch {
      throw fastify.httpErrors.unauthorized("Invalid or expired token");
    }

    if (!payload.sub) {
      throw fastify.httpErrors.unauthorized("Token missing subject");
    }

    // Resolve profile from auth_id
    const { getProfileByAuthId } = await import("../utils/get-profile.js");
    const profile = await getProfileByAuthId(fastify.supabase, payload.sub);

    if (!profile) {
      throw fastify.httpErrors.unauthorized("User profile not found");
    }

    // Attach user info to request
    (request as unknown as { user: AuthUser }).user = {
      authId: payload.sub,
      profileId: profile.id,
      role: profile.role as "ADMIN" | "WORKER",
      email: payload.email ?? profile.email,
    };
  });
};

export default fp(authPlugin, { name: "auth" });
