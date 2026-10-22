import fs from 'fs';
import path from 'path';
import { Pool, PoolClient, types } from 'pg';
import type { Logger } from './logger';

// NUMERIC -> number (money is stored as NUMERIC(14,2))
types.setTypeParser(1700, (v) => parseFloat(v));
// BIGINT (e.g. COUNT(*)) -> number
types.setTypeParser(20, (v) => parseInt(v, 10));
// DATE -> 'YYYY-MM-DD' string (avoid timezone shifts)
types.setTypeParser(1082, (v) => v);

/** Anything that can run a query: a Pool or a PoolClient inside a transaction. */
export type Queryable = Pick<PoolClient, 'query'>;

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 10 });
}

/** Run fn inside BEGIN/COMMIT, rolling back on error. */
export async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Idempotent event handling. Requires a `processed_events(event_id UUID PRIMARY KEY)` table.
 * Returns false if the event was already processed.
 */
export async function handleOnce(
  pool: Pool,
  eventId: string,
  fn: (client: PoolClient) => Promise<void>,
): Promise<boolean> {
  return transaction(pool, async (client) => {
    const res = await client.query(
      'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [eventId],
    );
    if (res.rowCount === 0) return false;
    await fn(client);
    return true;
  });
}

/**
 * Applies migrations/*.sql in filename order, once each. Migrations are
 * append-only: NEVER edit a migration that has been committed; add a new file.
 */
export async function runMigrations(pool: Pool, dir: string, logger: Logger): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await transaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    logger.info({ migration: file }, 'Applied migration');
  }
}

/** Postgres unique_violation */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
