import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createApp, createLogger, env } from '@rental/common';

const SERVICE = 'api-gateway';

/**
 * Route table. To expose a new service: add ONE entry here,
 * plus its *_URL env var in docker-compose.yml.
 * Prefix is stripped: /api/property/leases -> property-service /leases
 */
const routes: Record<string, string> = {
  '/api/auth': env('AUTH_SERVICE_URL', 'http://localhost:4001'),
  '/api/property': env('PROPERTY_SERVICE_URL', 'http://localhost:4002'),
  '/api/accounting': env('ACCOUNTING_SERVICE_URL', 'http://localhost:4003'),
  '/api/commerce': env('COMMERCE_SERVICE_URL', 'http://localhost:4004'),
};

function main() {
  const logger = createLogger(SERVICE);
  const port = Number(process.env['GATEWAY_PORT'] ?? env('PORT', '8080'));

  // json:false -> do NOT parse bodies; they are streamed to the services.
  const app = createApp(SERVICE, { json: false });
  app.use(cors({ origin: env('CORS_ORIGIN', '*') }));

  for (const [prefix, target] of Object.entries(routes)) {
    app.use(
      prefix,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        on: {
          error: (err, _req, res) => {
            logger.error({ err: err.message, target }, 'Upstream error');
            const r = res as import('http').ServerResponse;
            if (!r.headersSent) {
              r.writeHead(502, { 'Content-Type': 'application/json' });
            }
            r.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: 'Upstream service unavailable' } }));
          },
        },
      }),
    );
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.listen(port, () => logger.info({ port, routes: Object.keys(routes) }, `${SERVICE} listening`));
}

main();
