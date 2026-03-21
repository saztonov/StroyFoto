import { z } from "zod";

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  token: z.string(), // backward compat alias for accessToken
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    role: z.enum(["ADMIN", "WORKER"]),
    fullName: z.string(),
  }),
});

export const tokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  username: z.string(),
  role: z.enum(["ADMIN", "WORKER"]),
  iat: z.number(),
  exp: z.number(),
});

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type TokenPayload = z.infer<typeof tokenPayloadSchema>;
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
