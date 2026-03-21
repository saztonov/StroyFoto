import { FastifyPluginAsync } from "fastify";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { loginRequestSchema, refreshRequestSchema } from "@stroyfoto/shared";
import { config } from "../config.js";
import { snakeToCamel } from "../utils/case-transform.js";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/auth/login
  fastify.post("/api/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { username, password } = parsed.data;

    const { data: user, error } = await fastify.supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();

    if (error || !user) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }

    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return reply.status(401).send({ error: "Invalid username or password" });
    }

    const accessToken = fastify.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    // Generate refresh token
    const refreshTokenValue = crypto.randomUUID();
    const refreshExpiresMs = parseExpiry(config.JWT_REFRESH_EXPIRES_IN);

    await fastify.supabase.from("refresh_tokens").insert({
      token: refreshTokenValue,
      user_id: user.id,
      expires_at: new Date(Date.now() + refreshExpiresMs).toISOString(),
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      token: accessToken, // backward compat
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name,
      },
    };
  });

  // POST /api/auth/refresh
  fastify.post("/api/auth/refresh", async (request, reply) => {
    const parsed = refreshRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body" });
    }

    const { refreshToken } = parsed.data;

    const { data: stored, error } = await fastify.supabase
      .from("refresh_tokens")
      .select("*, users(*)")
      .eq("token", refreshToken)
      .single();

    if (error || !stored || new Date(stored.expires_at) < new Date()) {
      if (stored) {
        await fastify.supabase.from("refresh_tokens").delete().eq("id", stored.id);
      }
      return reply.status(401).send({ error: "Invalid or expired refresh token" });
    }

    // Rotate: delete old, create new
    await fastify.supabase.from("refresh_tokens").delete().eq("id", stored.id);

    const newRefreshTokenValue = crypto.randomUUID();
    const refreshExpiresMs = parseExpiry(config.JWT_REFRESH_EXPIRES_IN);

    await fastify.supabase.from("refresh_tokens").insert({
      token: newRefreshTokenValue,
      user_id: stored.user_id,
      expires_at: new Date(Date.now() + refreshExpiresMs).toISOString(),
    });

    const user = stored.users as { id: string; username: string; role: string };

    const accessToken = fastify.jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    return {
      accessToken,
      refreshToken: newRefreshTokenValue,
    };
  });
};

function parseExpiry(value: string): number {
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // fallback 30d
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return num * (multipliers[unit] ?? 1000);
}

export default authRoutes;
