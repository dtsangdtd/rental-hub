# Event Catalog

Exchange: `rental.events` (topic, durable). Routing key = event `type`.
Envelope (`DomainEvent`): `{ id: uuid, type, source, occurredAt, data }`.
Payload types: `packages/common/src/contracts.ts`.

| Event | Publisher | Consumers | Trigger | Payload |
|---|---|---|---|---|
| `auth.user.registered` | auth | — | User created | `UserRegisteredData` |
| `property.lease.created` | property | accounting | Lease created (unit becomes occupied) | `LeaseCreatedData` |
| `property.lease.terminated` | property | accounting | Lease terminated (unit becomes vacant) | `LeaseTerminatedData` |
| `commerce.order.placed` | commerce | accounting | Order placed, stock reserved | `OrderPlacedData` |
| `commerce.order.cancelled` | commerce | accounting | Pending order cancelled, stock restored | `OrderCancelledData` |
| `accounting.invoice.paid` | accounting | commerce | Invoice fully paid | `InvoicePaidData` |

Queues: `accounting-service.events` and `commerce-service.events`.

## Versioning rules
- Adding an optional field is OK.
- Removing or renaming a field, or changing its meaning, is not. Publish `<name>.v2` instead and keep the old event until every consumer has migrated.
