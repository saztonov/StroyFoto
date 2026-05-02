import { z } from 'zod';
import { AppError } from './errors.js';

export function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  body: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Проверьте введённые данные.',
    );
  }
  return parsed.data;
}

export function parseQuery<S extends z.ZodTypeAny>(
  schema: S,
  query: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Проверьте параметры запроса.',
    );
  }
  return parsed.data;
}

export function parseParams<S extends z.ZodTypeAny>(
  schema: S,
  params: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Некорректные параметры пути.',
    );
  }
  return parsed.data;
}

export const uuidSchema = z.string().uuid('Ожидается UUID');

export const isoDateSchema = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ожидается ISO-дата');

export const idParamsSchema = z.object({ id: uuidSchema });

export function parseUuidList(input: string, max = 200): string[] {
  const arr = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (arr.length === 0) return [];
  if (arr.length > max) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Не более ${max} идентификаторов в одном запросе.`,
    );
  }
  const result = z.array(uuidSchema).safeParse(arr);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Список идентификаторов содержит некорректные значения.',
    );
  }
  return result.data;
}
