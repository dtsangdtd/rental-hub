# Event Catalog

Exchange: `rental.events` (topic, durable). Routing key = event `type`.
Envelope (`DomainEvent`): `{ id: uuid, type, source, occurredAt, data }`.
Payload types: `packages/common/src/contracts.ts`.

| Event | Publisher | Consumers | Trigger | Payload |
|---|---|---|---|---|
| `auth.user.registered` | auth | — | User created | `UserRegisteredData` |
| `property.lease.created` | property | accounting | Lease created (unit becomes occupied) | `LeaseCreatedData` |
| `property.lease.terminated` | property | accounting | Lease terminated (unit becomes vacant) | `LeaseTerminatedData` |
| `property.autoinvoice.toggled` | property | accounting | Auto-invoice toggle changed on property | `PropertyAutoInvoiceToggledData` |
| `commerce.order.placed` | commerce | accounting | Order placed, stock reserved | `OrderPlacedData` |
| `commerce.order.cancelled` | commerce | accounting | Pending order cancelled, stock restored | `OrderCancelledData` |
| `accounting.invoice.paid` | accounting | commerce | Invoice fully paid | `InvoicePaidData` |

Queues: `accounting-service.events` and `commerce-service.events`.

## Reliability & Transactional Outbox Pattern
- **Persistence:** Every publishing service maintains an `outbox_events` table in its own PostgreSQL database.
- **Transactional guarantees:** When an event is published via `bus.publish(type, data)`, it is first recorded in `outbox_events` with `published_at IS NULL`.
- **OutboxRelay:** A background worker (`OutboxRelay`) polls pending events (`FOR UPDATE SKIP LOCKED`) and publishes them to RabbitMQ. Once acknowledged, `published_at` is timestamped.
- **Offline / Failure tolerance:** If RabbitMQ is down, stopped, or disconnected, events remain safely stored in PostgreSQL. As soon as RabbitMQ becomes available, `EventBus` auto-reconnects and `OutboxRelay` flushes all pending events in chronological order. No messages are ever lost.
- **Consumer idempotency:** All consumers process events with `handleOnce(pool, event.id, async (client) => { ... })` against their local `processed_events` table to prevent duplicate side effects.

## Versioning rules
- Adding an optional field is OK.
- Removing or renaming a field, or changing its meaning, is not. Publish `<name>.v2` instead and keep the old event until every consumer has migrated.
