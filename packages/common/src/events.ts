import { randomUUID } from 'crypto';
import amqp, { Channel } from 'amqplib';
import { sleep } from './config';
import type { Logger } from './logger';

export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  data: T;
}

type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

/**
 * Thin RabbitMQ wrapper. All events go to one durable topic exchange;
 * routing key = event type (e.g. "property.lease.created").
 * Gracefully operates in offline mode if RabbitMQ is not running during local dev.
 */
export class EventBus {
  private connection?: AmqpConnection;
  private channel?: Channel;

  constructor(
    private readonly url: string,
    private readonly source: string,
    private readonly logger: Logger,
    private readonly exchange = 'rental.events',
  ) {}

  async connect(maxAttempts = 3): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        this.connection = await amqp.connect(this.url);
        this.channel = await this.connection.createChannel();
        await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
        this.logger.info('Connected to RabbitMQ');
        return;
      } catch (err) {
        if (attempt >= maxAttempts) {
          this.logger.warn(
            { err: (err as Error).message },
            'RabbitMQ unavailable — running with offline event logging',
          );
          return;
        }
        this.logger.warn({ attempt }, 'RabbitMQ not ready, retrying in 1s');
        await sleep(1000);
      }
    }
  }

  /** Publish AFTER the DB transaction commits. */
  async publish<T>(type: string, data: T): Promise<DomainEvent<T>> {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      type,
      source: this.source,
      occurredAt: new Date().toISOString(),
      data,
    };

    if (this.channel) {
      this.channel.publish(this.exchange, type, Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.id,
        type,
      });
      this.logger.info({ eventId: event.id, type }, 'Event published to RabbitMQ');
    } else {
      this.logger.info({ eventId: event.id, type }, 'Event published (offline mode)');
    }
    return event;
  }

  /**
   * Subscribe a durable queue to routing-key patterns. Handlers MUST be idempotent
   * (use handleOnce). Failed messages are nacked without requeue (dead-lettered).
   */
  async subscribe(
    queue: string,
    patterns: string[],
    handler: (event: DomainEvent) => Promise<void>,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn({ queue, patterns }, 'RabbitMQ offline — queue subscriptions skipped');
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
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }
}
