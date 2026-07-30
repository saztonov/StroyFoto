import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    // Машиночитаемый контекст ошибки. Клиент читает его через ApiError.details
    // — например, чтобы понять, какая именно позиция справочника заблокировала
    // отчёт, и не разбирать для этого текст сообщения.
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: error.flatten(),
        },
      });
      return;
    }

    if (error.validation) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation,
        },
      });
      return;
    }

    request.log.error({ err: error }, 'unhandled error');
    reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });
}
