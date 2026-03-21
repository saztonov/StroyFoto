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

export type DictionaryItem = z.infer<typeof dictionaryItemSchema>;
export type ProjectItem = z.infer<typeof projectSchema>;
export type AreaItem = z.infer<typeof areaSchema>;
export type DictionariesResponse = z.infer<typeof dictionariesResponseSchema>;
