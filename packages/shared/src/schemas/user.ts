import { z } from "zod";

export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.enum(["ADMIN", "WORKER"]),
  fullName: z.string(),
  createdAt: z.coerce.date(),
});

export type User = z.infer<typeof userSchema>;
