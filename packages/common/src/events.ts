import { randomUUID } from 'crypto';
import amqp, { Channel } from 'amqplib';
import { Pool, PoolClient } from 'pg';
import { sleep } from './config';
import type { Logger } from './logger';
import { insertOutboxEvent, OutboxRelay } from './outbox';

export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  data: T;
}

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

interface SubscriptionRegistration {
  queue: string;
  patterns: string[];
  handler: (event: DomainEvent) => Promise<void>;
}

/**
 * Robust RabbitMQ EventBus with:
 * - Automatic background reconnection when RabbitMQ restarts/crashes
 * - Automatic queue re-subscription after reconnect
 * - Transactional Outbox integration (persistent messages in PostgreSQL)
 * - Safe publish methods that never crash HTTP requests
 */
export class EventBus {
  private connection?: AmqpConnection;
  private channel?: Channel;
  private reconnecting = false;
  private isClosed = false;
  private subscriptions: SubscriptionRegistration[] = [];
  private outboxPool?: Pool;
  private outboxRelay?: OutboxRelay;

  constructor(
    private readonly url: string,
    private readonly source: string,
    private readonly logger: Logger,
    private readonly exchange = 'rental.events',
  ) {}

  /**
   * Connect to RabbitMQ. If initial connection fails, gracefully logs and
   * schedules a background reconnect loop.
   */
  async connect(maxAttempts = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.doConnect();
        this.logger.info('Connected to RabbitMQ');
        return;
      } catch (err) {
        if (attempt >= maxAttempts) {
          this.logger.warn(
            { err: (err as Error).message },
            'RabbitMQ unavailable on startup — continuing with offline / outbox mode',
          );
          this.scheduleReconnect(3000);
          return;
        }
        this.logger.warn({ attempt }, 'RabbitMQ not ready, retrying in 1s');
        await sleep(1000);
      }
    }
  }

  private async doConnect(): Promise<void> {
    if (this.isClosed) return;

    const conn = await amqp.connect(this.url);
    const ch = await conn.createChannel();
    await ch.assertExchange(this.exchange, 'topic', { durable: true });

    conn.on('close', () => {
      this.channel = undefined;
      this.connection = undefined;
      if (!this.isClosed) {
        this.logger.warn('RabbitMQ connection lost, will attempt reconnect...');
        this.scheduleReconnect(3000);
      }
    });

    conn.on('error', (err) => {
      this.logger.warn({ err: err.message }, 'RabbitMQ connection error');
    });

    ch.on('error', (err) => {
      this.logger.warn({ err: err.message }, 'RabbitMQ channel error');
    });

    this.connection = conn;
    this.channel = ch;

    // Re-assert existing subscriptions on reconnect
    await this.reapplySubscriptions();
  }

  private scheduleReconnect(delayMs = 3000): void {
    if (this.reconnecting || this.isClosed) return;
    this.reconnecting = true;

    setTimeout(async () => {
      try {
        if (!this.isConnected() && !this.isClosed) {
          await this.doConnect();
          this.logger.info('RabbitMQ connection re-established successfully');
          this.outboxRelay?.trigger();
        }
      } catch {
        // Still unreachable, schedule another retry
        this.reconnecting = false;
        this.scheduleReconnect(delayMs);
        return;
      }
      this.reconnecting = false;
    }, delayMs);
  }

  private async reapplySubscriptions(): Promise<void> {
    if (!this.channel || this.subscriptions.length === 0) return;
    const ch = this.channel;

    for (const sub of this.subscriptions) {
      try {
        await ch.assertQueue(sub.queue, { durable: true });
        for (const pattern of sub.patterns) {
          await ch.bindQueue(sub.queue, this.exchange, pattern);
        }
        await ch.prefetch(10);
        await ch.consume(sub.queue, async (msg) => {
          if (!msg) return;
          let event: DomainEvent | undefined;
          try {
            event = JSON.parse(msg.content.toString()) as DomainEvent;
            await sub.handler(event);
            ch.ack(msg);
          } catch (err) {
            this.logger.error({ err, eventId: event?.id, type: event?.type }, 'Event handler failed');
            ch.nack(msg, false, false);
          }
        });
        this.logger.info({ queue: sub.queue, patterns: sub.patterns }, 'Subscribed queue reconnected');
      } catch (err) {
        this.logger.error({ err, queue: sub.queue }, 'Failed to re-apply subscription');
      }
    }
  }

  /** Check if AMQP channel is currently open and healthy */
  isConnected(): boolean {
    return Boolean(this.connection && this.channel);
  }

  /**
   * Attaches a PostgreSQL pool to enable Transactional Outbox.
   * All subsequent `bus.publish()` calls will write to `outbox_events` first,
   * guaranteeing that events are never lost even if RabbitMQ is offline.
   */
  attachOutbox(pool: Pool, pollIntervalMs = 2000): OutboxRelay {
    this.outboxPool = pool;
    this.outboxRelay = new OutboxRelay(pool, this, this.logger, pollIntervalMs);
    this.outboxRelay.start();
    return this.outboxRelay;
  }

  /**
   * Publish raw message directly to RabbitMQ topic exchange.
   * Returns true on success, false if offline/failed. Never throws.
   */
  async publishRaw(event: DomainEvent): Promise<boolean> {
    if (!this.channel) return false;
    try {
      return this.channel.publish(
        this.exchange,
        event.type,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          contentType: 'application/json',
          messageId: event.id,
          type: event.type,
        },
      );
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, eventId: event.id }, 'RabbitMQ publishRaw failed');
      return false;
    }
  }

  /**
   * Publish an event.
   * If an Outbox is attached (or a client/pool is passed), stores the event in PostgreSQL
   * outbox_events table first, then triggers the relay. If RabbitMQ is down, the event
   * remains pending in PostgreSQL until RabbitMQ comes online.
   */
  async publish<T>(
    type: string,
    data: T,
    clientOrPool?: Pool | PoolClient,
  ): Promise<DomainEvent<T>> {
    const targetPool = clientOrPool || this.outboxPool;

    if (targetPool) {
      // 1. Transactional Outbox mode: persist event in PostgreSQL
      const event = await insertOutboxEvent(targetPool, this.source, type, data);
      this.logger.info({ eventId: event.id, type }, 'Event recorded to Outbox');

      // 2. Trigger OutboxRelay to deliver immediately
      this.outboxRelay?.trigger();
      return event;
    }

    // Direct mode fallback (if outbox not attached)
    const event: DomainEvent<T> = {
      id: randomUUID(),
      type,
      source: this.source,
      occurredAt: new Date().toISOString(),
      data,
    };

    const sent = await this.publishRaw(event);
    if (sent) {
      this.logger.info({ eventId: event.id, type }, 'Event published to RabbitMQ');
    } else {
      this.logger.info({ eventId: event.id, type }, 'Event published (offline mode)');
    }
    return event;
  }

  /**
   * Subscribe a durable queue to routing-key patterns. Handlers MUST be idempotent
   * (use handleOnce). Subscriptions automatically survive RabbitMQ restarts.
   */
  async subscribe(
    queue: string,
    patterns: string[],
    handler: (event: DomainEvent) => Promise<void>,
  ): Promise<void> {
    // Save registration for auto-resubscribe on reconnect
    this.subscriptions.push({ queue, patterns, handler });

    if (!this.channel) {
      this.logger.warn(
        { queue, patterns },
        'RabbitMQ currently offline — queue subscription registered and will activate on connect',
      );
      return;
    }

    const ch = this.channel;
    await ch.assertQueue(queue, { durable: true });
    for (const pattern of patterns) await ch.bindQueue(queue, this.exchange, pattern);
    await ch.prefetch(10);
    await ch.consume(queue, async (msg) => {
      if (!msg) return;
      let event: DomainEvent | undefined;
      try {
        event = JSON.parse(msg.content.toString()) as DomainEvent;
        await handler(event);
        ch.ack(msg);
      } catch (err) {
        this.logger.error({ err, eventId: event?.id, type: event?.type }, 'Event handler failed');
        ch.nack(msg, false, false);
      }
    });
    this.logger.info({ queue, patterns }, 'Subscribed');
  }

  async close(): Promise<void> {
    this.isClosed = true;
    this.outboxRelay?.stop();
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
