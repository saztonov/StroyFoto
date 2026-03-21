import { z } from "zod";

export const dictionaryItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const projectSchema = dictionaryItemSchema.extend({
  code: z.string(),
  address: z.string(),
});

export const areaSchema = dictionaryItemSchema.extend({
  projectId: z.string().uuid().nullable(),
});

export const dictionariesResponseSchema = z.object({
  projects: z.array(projectSchema),
  workTypes: z.array(dictionaryItemSchema),
  contractors: z.array(dictionaryItemSchema),
  areas: z.array(areaSchema),
  versions: z.object({
    projects: z.string(),
    workTypes: z.string(),
    contractors: z.string(),
    areas: z.string(),
  }),
});

// Create/Update schemas for admin CRUD
export const createProjectSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  address: z.string().default(""),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const createDictionaryItemSchema = z.object({
  name: z.string().min(1),
});

export const updateDictionaryItemSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const createAreaSchema = z.object({
  name: z.string().min(1),
  projectId: z.string().uuid().nullable().optional(),
});

export const updateAreaSchema = z.object({
  name: z.string().min(1).optional(),
  projectId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type DictionaryItem = z.infer<typeof dictionaryItemSchema>;
export type ProjectItem = z.infer<typeof projectSchema>;
export type AreaItem = z.infer<typeof areaSchema>;
export type DictionariesResponse = z.infer<typeof dictionariesResponseSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export type UpdateProject = z.infer<typeof updateProjectSchema>;
export type CreateDictionaryItem = z.infer<typeof createDictionaryItemSchema>;
export type UpdateDictionaryItem = z.infer<typeof updateDictionaryItemSchema>;
export type CreateArea = z.infer<typeof createAreaSchema>;
export type UpdateArea = z.infer<typeof updateAreaSchema>;
