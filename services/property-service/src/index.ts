import path from 'path';
import {
  createApp,
  createLogger,
  createPool,
  env,
  envNumber,
  errorHandler,
  EventBus,
  requireAuth,
  runMigrations,
} from '@rental/common';
import { buildRouter } from './routes';

const SERVICE = 'property-service'; // restarted after migration 011 fix

async function main() {
  const logger = createLogger(SERVICE);
  const port = envNumber(['PROPERTY_PORT', 'PORT'], 4002);
  const pool = createPool(env(['PROPERTY_DATABASE_URL', 'DATABASE_URL'], 'postgres://rental:rental@localhost:5432/property_db'));
  const bus = new EventBus(env('RABBITMQ_URL', 'amqp://rental:rental@localhost:5672'), SERVICE, logger);
  const jwtSecret = env('JWT_SECRET', 'dev-secret-change-me');

  await runMigrations(pool, path.join(__dirname, '../migrations'), logger);
  await bus.connect();
  bus.attachOutbox(pool);

  const app = createApp(SERVICE);
  const authMiddleware = requireAuth(jwtSecret);
  app.use((req, res, next) => {
    if (req.path.startsWith('/internal/')) return next();
    return authMiddleware(req, res, next);
  });
  app.use('/', buildRouter({ pool, bus }));
  app.use(errorHandler(logger));

  const server = app.listen(port, () => logger.info({ port }, `${SERVICE} listening`));
  const shutdown = async () => {
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
