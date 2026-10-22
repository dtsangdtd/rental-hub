import path from 'path';
import { createApp, createLogger, createPool, env, errorHandler, EventBus, runMigrations } from '@rental/common';
import { buildRouter, seedAdmin } from './routes';

const SERVICE = 'auth-service';

async function main() {
  const logger = createLogger(SERVICE);
  const port = Number(process.env['AUTH_PORT'] ?? env('PORT', '4001'));
  const pool = createPool(process.env['AUTH_DATABASE_URL'] ?? env('DATABASE_URL', 'postgres://rental:rental@localhost:5432/auth_db'));
  const bus = new EventBus(env('RABBITMQ_URL', 'amqp://rental:rental@localhost:5672'), SERVICE, logger);
  const jwtSecret = env('JWT_SECRET', 'dev-secret-change-me');

  await runMigrations(pool, path.join(__dirname, '../migrations'), logger);
  await bus.connect();
  if (await seedAdmin(pool, env('ADMIN_EMAIL', 'admin@rental.local'), env('ADMIN_PASSWORD', 'admin12345'))) {
    logger.info('Seeded bootstrap admin user');
  }

  const app = createApp(SERVICE);
  app.use('/', buildRouter({ pool, bus, jwtSecret }));
  app.use(errorHandler(logger));

  const server = app.listen(port, () => logger.info({ port }, `${SERVICE} listening`));
  const shutdown = async () => {
    logger.info('Shutting down');
    server.close();
    await bus.close().catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
