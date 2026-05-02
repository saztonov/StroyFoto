import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import {
  isoDateSchema,
  parseBody,
  parseParams,
  uuidSchema,
} from '../http/validate.js';
import { deletePhoto, upsertPhoto } from '../services/photosService.js';

const photoParamsSchema = z.object({ photoId: uuidSchema });

const upsertSchema = z.object({
  report_id: uuidSchema,
  r2_key: z.string().min(1).max(500),
  thumb_r2_key: z.string().min(1).max(500).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  taken_at: isoDateSchema.nullable().optional(),
  storage: z.enum(['cloudru', 'r2']).optional(),
});

export default async function photosRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.put('/:photoId', guard, async (request) => {
    const { photoId } = parseParams(photoParamsSchema, request.params);
    const body = parseBody(upsertSchema, request.body);
    const photo = await upsertPhoto({
      user: request.user!,
      id: photoId,
      report_id: body.report_id,
      r2_key: body.r2_key,
      thumb_r2_key: body.thumb_r2_key ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      taken_at: body.taken_at ?? null,
      storage: body.storage ?? 'cloudru',
    });
    return { photo };
  });

  app.delete('/:photoId', guard, async (request) => {
    const { photoId } = parseParams(photoParamsSchema, request.params);
    await deletePhoto({ user: request.user!, id: photoId });
    return { ok: true };
  });
}
