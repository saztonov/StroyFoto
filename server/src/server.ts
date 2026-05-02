import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main();
