import pino, { Logger } from 'pino';

export type { Logger };

/** Structured JSON logger. Never use console.log in services. */
export function createLogger(service: string): Logger {
  return pino({ name: service, level: process.env.LOG_LEVEL ?? 'info' });
}
