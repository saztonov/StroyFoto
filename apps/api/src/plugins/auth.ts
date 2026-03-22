import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

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

    const { data, error } = await fastify.supabase.auth.getUser(token);
    if (error || !data.user) {
      throw fastify.httpErrors.unauthorized("Invalid or expired token");
    }

    const authUser = data.user;

    const { getProfileByAuthId } = await import("../utils/get-profile.js");
    const profile = await getProfileByAuthId(fastify.supabase, authUser.id);

    if (!profile) {
      throw fastify.httpErrors.unauthorized("User profile not found");
    }

    (request as unknown as { user: AuthUser }).user = {
      authId: authUser.id,
      profileId: profile.id,
      role: profile.role as "ADMIN" | "WORKER",
      email: authUser.email ?? profile.email,
    };
  });
};

export default fp(authPlugin, { name: "auth", dependencies: ["supabase"] });
