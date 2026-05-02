import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerErrorHandler } from './http/errors.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profile.js';
import adminProfilesRoutes from './routes/adminProfiles.js';
import projectsRoutes from './routes/projects.js';
import adminProjectsRoutes from './routes/adminProjects.js';
import workTypesRoutes from './routes/workTypes.js';
import adminWorkTypesRoutes from './routes/adminWorkTypes.js';
import workAssignmentsRoutes from './routes/workAssignments.js';
import adminWorkAssignmentsRoutes from './routes/adminWorkAssignments.js';
import performersRoutes from './routes/performers.js';
import adminPerformersRoutes from './routes/adminPerformers.js';
import plansRoutes from './routes/plans.js';
import reportsRoutes from './routes/reports.js';
import photosRoutes from './routes/photos.js';
import authorNamesRoutes from './routes/authorNames.js';
import presignRoutes from './routes/presign.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    maxAge: 600,
  });

  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(profileRoutes, { prefix: '/api/profile' });

  await app.register(adminProfilesRoutes, { prefix: '/api/admin/profiles' });
  await app.register(projectsRoutes, { prefix: '/api/projects' });
  await app.register(adminProjectsRoutes, { prefix: '/api/admin/projects' });

  await app.register(workTypesRoutes, { prefix: '/api/work-types' });
  await app.register(adminWorkTypesRoutes, { prefix: '/api/admin/work-types' });

  await app.register(workAssignmentsRoutes, { prefix: '/api/work-assignments' });
  await app.register(adminWorkAssignmentsRoutes, {
    prefix: '/api/admin/work-assignments',
  });

  await app.register(performersRoutes, { prefix: '/api/performers' });
  await app.register(adminPerformersRoutes, { prefix: '/api/admin/performers' });

  // plans внутри регистрируются как /plans и /projects/:projectId/plans —
  // поэтому общий префикс /api.
  await app.register(plansRoutes, { prefix: '/api' });

  await app.register(reportsRoutes, { prefix: '/api/reports' });
  await app.register(photosRoutes, { prefix: '/api/report-photos' });
  await app.register(authorNamesRoutes, { prefix: '/api/author-names' });
  await app.register(presignRoutes, { prefix: '/api/storage/presign' });

  return app;
}
