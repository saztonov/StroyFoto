import { z } from "zod";

// Supabase Auth uses email-based authentication.
// These schemas are kept for backward compatibility with frontend form validation.

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(1).max(100),
});

// Token payload from Supabase Auth JWT
export const tokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email().optional(),
  app_metadata: z
    .object({
      app_role: z.enum(["ADMIN", "WORKER"]).optional(),
    })
    .optional(),
  iat: z.number(),
  exp: z.number(),
});

// Profile returned after login (from our API)
export const profileResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: z.enum(["ADMIN", "WORKER"]),
  fullName: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type TokenPayload = z.infer<typeof tokenPayloadSchema>;
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
