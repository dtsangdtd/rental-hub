import path from 'path';
import {
  createApp,
  createLogger,
  createPool,
  env,
  envNumber,
  errorHandler,
  EventBus,
  optionalAuth,
  requireAuth,
  runMigrations,
} from '@rental/common';
import { buildRouter } from './routes';
import { registerConsumers } from './consumers';

const SERVICE = 'commerce-service';

async function main() {
  const logger = createLogger(SERVICE);
  const port = envNumber(['COMMERCE_PORT', 'PORT'], 4004);
  const pool = createPool(env(['COMMERCE_DATABASE_URL', 'DATABASE_URL'], 'postgres://rental:rental@localhost:5432/commerce_db'));
  const bus = new EventBus(env('RABBITMQ_URL', 'amqp://rental:rental@localhost:5672'), SERVICE, logger);
  const jwtSecret = env('JWT_SECRET', 'dev-secret-change-me');

  await runMigrations(pool, path.join(__dirname, '../migrations'), logger);
  await bus.connect();
  bus.attachOutbox(pool);
  await registerConsumers(pool, bus, logger);

  const app = createApp(SERVICE);
  const auth = requireAuth(jwtSecret);
  const optAuth = optionalAuth(jwtSecret);

  app.use((req, res, next) => {
    const isPublic =
      req.path === '/checkout' ||
      req.path === '/categories' ||
      req.path === '/hubs' ||
      req.path.startsWith('/guest/') ||
      req.path.startsWith('/events/') ||
      (req.method === 'GET' && (req.path === '/products' || req.path.startsWith('/products/'))) ||
      (req.method === 'GET' && req.path.startsWith('/orders/'));
    if (isPublic) {
      return optAuth(req, res, next);
    }
    return auth(req, res, next);
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
