import { AppError } from './errors.js';

interface PgErrorLike {
  code?: string;
  detail?: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgErrorLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string'
  );
}

export interface PgErrorMapping {
  uniqueViolation?: { code: string; message: string };
  foreignKeyViolation?: { code: string; message: string };
  checkViolation?: { code: string; message: string };
  notNullViolation?: { code: string; message: string };
}

export function mapPgError(err: unknown, mapping: PgErrorMapping = {}): never {
  if (!isPgError(err)) {
    throw err;
  }
  switch (err.code) {
    case '23505': {
      const m = mapping.uniqueViolation ?? {
        code: 'CONFLICT',
        message: 'Запись с такими данными уже существует.',
      };
      throw new AppError(409, m.code, m.message);
    }
    case '23503': {
      const m = mapping.foreignKeyViolation ?? {
        code: 'FK_VIOLATION',
        message: 'Связанные данные не найдены или используются.',
      };
      throw new AppError(422, m.code, m.message);
    }
    case '23514': {
      const m = mapping.checkViolation ?? {
        code: 'CHECK_VIOLATION',
        message: 'Нарушено ограничение значений.',
      };
      throw new AppError(422, m.code, m.message);
    }
    case '23502': {
      const m = mapping.notNullViolation ?? {
        code: 'NOT_NULL_VIOLATION',
        message: 'Не заполнено обязательное поле.',
      };
      throw new AppError(422, m.code, m.message);
    }
    default:
      throw err;
  }
}
