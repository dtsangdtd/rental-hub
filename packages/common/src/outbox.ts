import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import type { Logger } from './logger';
import type { DomainEvent, EventBus } from './events';

export interface OutboxRow {
  id: string;
  event_type: string;
  source: string;
  occurred_at: string | Date;
  payload: unknown;
  published_at?: string | Date | null;
  retry_count: number;
  last_error?: string | null;
  created_at: string | Date;
}

/**
 * Inserts an event into the outbox_events table.
 * Can be run within an existing database transaction client so business data
 * and outbox events are committed atomically (Transactional Outbox Pattern).
 */
export async function insertOutboxEvent<T = unknown>(
  client: Pool | PoolClient,
  source: string,
  type: string,
  data: T,
  id: string = randomUUID(),
  occurredAt: string = new Date().toISOString(),
): Promise<DomainEvent<T>> {
  const event: DomainEvent<T> = {
    id,
    type,
    source,
    occurredAt,
    data,
  };

  await client.query(
    `INSERT INTO outbox_events (id, event_type, source, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.type, event.source, event.occurredAt, JSON.stringify(event.data)],
  );

  return event;
}

/**
 * OutboxRelay periodically polls outbox_events where published_at IS NULL,
 * publishes them to RabbitMQ via EventBus.publishRaw(), and marks them published.
 * If RabbitMQ is down, events stay safe in PostgreSQL and are sent when RabbitMQ recovers.
 */
export class OutboxRelay {
  private timer?: NodeJS.Timeout;
  private running = false;
  private isProcessing = false;

  constructor(
    private readonly pool: Pool,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly pollIntervalMs = 2000,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(200);
    this.logger.info('OutboxRelay background worker started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.logger.info('OutboxRelay background worker stopped');
  }

  /** Trigger an immediate flush (e.g. right after a new event is committed) */
  trigger(): void {
    if (!this.running) return;
    setImmediate(() => {
      this.processPending().catch((err) => {
        this.logger.warn({ err: (err as Error).message }, 'Error in triggered outbox flush');
      });
    });
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      try {
        await this.processPending();
      } catch (err) {
        this.logger.warn({ err: (err as Error).message }, 'Error in outbox relay loop');
      } finally {
        this.scheduleNext(this.pollIntervalMs);
      }
    }, delayMs);
  }

  async processPending(batchSize = 25): Promise<number> {
    if (this.isProcessing) return 0;
    // Don't query database if RabbitMQ isn't connected
    if (!this.bus.isConnected()) return 0;

    this.isProcessing = true;
    let processedCount = 0;

    try {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Select pending events with FOR UPDATE SKIP LOCKED (safe across multiple service instances)
        const { rows } = await client.query<OutboxRow>(
          `SELECT id, event_type, source, occurred_at, payload, retry_count
           FROM outbox_events
           WHERE published_at IS NULL
           ORDER BY created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED`,
          [batchSize],
        );

        if (rows.length === 0) {
          await client.query('COMMIT');
          return 0;
        }

        for (const row of rows) {
          const event: DomainEvent = {
            id: row.id,
            type: row.event_type,
            source: row.source,
            occurredAt:
              typeof row.occurred_at === 'string'
                ? row.occurred_at
                : new Date(row.occurred_at).toISOString(),
            data: row.payload,
          };

          const published = await this.bus.publishRaw(event);
          if (published) {
            await client.query(
              `UPDATE outbox_events
               SET published_at = NOW(), last_error = NULL
               WHERE id = $1`,
              [row.id],
            );
            processedCount++;
            this.logger.info(
              { eventId: row.id, type: row.event_type },
              'Outbox event relayed to RabbitMQ',
            );
          } else {
            await client.query(
              `UPDATE outbox_events
               SET retry_count = retry_count + 1,
                   last_error = 'RabbitMQ publishRaw returned false or channel closed'
               WHERE id = $1`,
              [row.id],
            );
            // If publish failed, break loop and wait for next interval
            break;
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }
}
