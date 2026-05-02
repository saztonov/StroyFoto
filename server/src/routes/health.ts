import type { FastifyInstance } from 'fastify';
import { queryDbHealth } from '../db.js';
import { AppError } from '../http/errors.js';

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return { ok: true, service: 'stroyfoto-api' };
  });

  app.get('/db-health', async (request) => {
    try {
      const result = await queryDbHealth();
      return result;
    } catch (err) {
      request.log.error({ err }, 'db-health check failed');
      throw new AppError(503, 'DB_UNREACHABLE', 'Database is not reachable');
    }
  });
}
