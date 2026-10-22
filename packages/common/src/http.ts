import express, { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodTypeAny } from 'zod';
import { AppError } from './errors';
import type { Logger } from './logger';

/** Creates an Express app with JSON parsing and a GET /health endpoint. */
export function createApp(serviceName: string, opts: { json?: boolean } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  if (opts.json !== false) app.use(express.json({ limit: '10mb' }));
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: serviceName, time: new Date().toISOString() });
  });
  return app;
}

/** Wrap async route handlers so rejected promises reach errorHandler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** Validate untrusted input with zod; throws a 400 AppError on failure. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', result.error.flatten());
  }
  return result.data;
}

/** Must be registered LAST: app.use(errorHandler(logger)). */
export function errorHandler(logger: Logger) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
      return;
    }
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  };
}
