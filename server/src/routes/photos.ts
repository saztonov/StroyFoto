import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireActiveUser } from '../auth/middleware.js';
import {
  isoDateSchema,
  parseBody,
  parseParams,
  uuidSchema,
} from '../http/validate.js';
import { AppError } from '../http/errors.js';
import {
  deletePhoto,
  getPhotoById,
  upsertPhoto,
} from '../services/photosService.js';

const photoParamsSchema = z.object({ photoId: uuidSchema });

const upsertSchema = z.object({
  report_id: uuidSchema,
  object_key: z.string().min(1).max(500),
  thumb_object_key: z.string().min(1).max(500).nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  taken_at: isoDateSchema.nullable().optional(),
});

export default async function photosRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { preHandler: [authenticate, requireActiveUser] };

  app.get('/:photoId', guard, async (request) => {
    const { photoId } = parseParams(photoParamsSchema, request.params);
    const photo = await getPhotoById({ user: request.user!, id: photoId });
    if (!photo) {
      throw new AppError(404, 'NOT_FOUND', 'Фотография не найдена.');
    }
    return { photo };
  });

  app.put('/:photoId', guard, async (request) => {
    const { photoId } = parseParams(photoParamsSchema, request.params);
    const body = parseBody(upsertSchema, request.body);
    const photo = await upsertPhoto({
      user: request.user!,
      id: photoId,
      report_id: body.report_id,
      object_key: body.object_key,
      thumb_object_key: body.thumb_object_key ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
      taken_at: body.taken_at ?? null,
    });
    return { photo };
  });

  app.delete('/:photoId', guard, async (request) => {
    const { photoId } = parseParams(photoParamsSchema, request.params);
    await deletePhoto({ user: request.user!, id: photoId });
    return { ok: true };
  });
}
