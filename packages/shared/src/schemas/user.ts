import { z } from "zod";

export const userRoleSchema = z.enum(["ADMIN", "WORKER"]);

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: userRoleSchema,
  fullName: z.string(),
  createdAt: z.coerce.date(),
});

export const updateUserRoleSchema = z.object({
  role: userRoleSchema,
});

export const updateUserProjectsSchema = z.object({
  projectIds: z.array(z.string().uuid()),
});

export type User = z.infer<typeof userSchema>;
export type UpdateUserRole = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserProjects = z.infer<typeof updateUserProjectsSchema>;
