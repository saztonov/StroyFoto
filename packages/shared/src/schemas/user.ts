import { z } from "zod";

export const userRoleSchema = z.enum(["ADMIN", "WORKER"]);

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: userRoleSchema,
  fullName: z.string(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
});

export const updateUserRoleSchema = z.object({
  role: userRoleSchema,
});

export const updateUserProjectsSchema = z.object({
  projectIds: z.array(z.string().uuid()),
});

export const updateUserProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const updateAdminUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: userRoleSchema.optional(),
  isActive: z.boolean().optional(),
});

export type User = z.infer<typeof userSchema>;
export type UpdateUserRole = z.infer<typeof updateUserRoleSchema>;
export type UpdateUserProjects = z.infer<typeof updateUserProjectsSchema>;
export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;
export type UpdateAdminUser = z.infer<typeof updateAdminUserSchema>;
