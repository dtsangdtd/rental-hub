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
import { autoGenerateMonthlyInvoices, registerConsumers } from './consumers';

const SERVICE = 'accounting-service';

async function main() {
  const logger = createLogger(SERVICE);
  const port = envNumber(['ACCOUNTING_PORT', 'PORT'], 4003);
  const pool = createPool(env(['ACCOUNTING_DATABASE_URL', 'DATABASE_URL'], 'postgres://rental:rental@localhost:5432/accounting_db'));
  const bus = new EventBus(env('RABBITMQ_URL', 'amqp://rental:rental@localhost:5672'), SERVICE, logger);
  const jwtSecret = env('JWT_SECRET', 'dev-secret-change-me');

  await runMigrations(pool, path.join(__dirname, '../migrations'), logger);
  await bus.connect();
  await registerConsumers(pool, bus, logger);

  // Background monthly billing check: auto-generates on configured billing day for properties with auto_invoice=true
  const runAutoBilling = async () => {
    try {
      const res = await autoGenerateMonthlyInvoices(pool);
      if (res.created > 0) {
        logger.info(res, 'Auto-generated monthly rent invoices for eligible properties with auto_invoice=true');
      }
    } catch (err) {
      logger.error(err, 'Failed to run auto-generate monthly invoices');
    }
  };
  void runAutoBilling();
  const autoBillInterval = setInterval(runAutoBilling, 60 * 60 * 1000);

  const app = createApp(SERVICE);
  app.use(requireAuth(jwtSecret));
  app.use('/', buildRouter({ pool, bus }));
  app.use(errorHandler(logger));

  const server = app.listen(port, () => logger.info({ port }, `${SERVICE} listening`));
  const shutdown = async () => {
    clearInterval(autoBillInterval);
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
