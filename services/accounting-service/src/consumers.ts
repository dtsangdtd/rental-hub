import { Pool } from 'pg';
import {
  DomainEvent,
  EventBus,
  Events,
  handleOnce,
  LeaseCreatedData,
  LeaseTerminatedData,
  Logger,
  OrderCancelledData,
  OrderPlacedData,
} from '@rental/common';
import { createInvoice, dueDateFor, periodOf } from './invoices';

/**
 * Event consumers. Every handler runs inside handleOnce() so redelivered
 * messages are ignored (idempotency).
 */
export async function registerConsumers(pool: Pool, bus: EventBus, logger: Logger) {
  await bus.subscribe(
    'accounting-service.events',
    [Events.LeaseCreated, Events.LeaseTerminated, Events.OrderPlaced, Events.OrderCancelled],
    async (event: DomainEvent) => {
      const handled = await handleOnce(pool, event.id, async (db) => {
        switch (event.type) {
          case Events.LeaseCreated: {
            const d = event.data as LeaseCreatedData;
            await db.query(
              `INSERT INTO lease_billing (lease_id, owner_id, tenant_id, tenant_user_id, monthly_rent,
                                          currency, due_day, start_date, end_date)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (lease_id) DO NOTHING`,
              [d.leaseId, d.ownerId, d.tenantId, d.tenantUserId, d.monthlyRent, d.currency, d.dueDay, d.startDate, d.endDate],
            );
            if (d.deposit > 0) {
              await createInvoice(db, {
                ownerId: d.ownerId,
                customerId: d.tenantUserId,
                referenceType: 'lease',
                referenceId: d.leaseId,
                kind: 'deposit',
                description: 'Security deposit',
                amount: d.deposit,
                currency: d.currency,
                dueDate: d.startDate,
              });
            }
            const period = periodOf(d.startDate);
            await createInvoice(db, {
              ownerId: d.ownerId,
              customerId: d.tenantUserId,
              referenceType: 'lease',
              referenceId: d.leaseId,
              kind: 'rent',
              period,
              description: `Rent ${period}`,
              amount: d.monthlyRent,
              currency: d.currency,
              dueDate: d.startDate,
            });
            break;
          }
          case Events.LeaseTerminated: {
            const d = event.data as LeaseTerminatedData;
            await db.query('UPDATE lease_billing SET active = FALSE WHERE lease_id = $1', [d.leaseId]);
            break;
          }
          case Events.OrderPlaced: {
            const d = event.data as OrderPlacedData;
            const today = new Date().toISOString().slice(0, 10);
            await createInvoice(db, {
              ownerId: null,
              customerId: d.customerId,
              referenceType: 'order',
              referenceId: d.orderId,
              kind: 'order',
              description: `Order ${d.orderId.slice(0, 8)} (${d.items.length} items)`,
              amount: d.total,
              currency: d.currency,
              dueDate: today,
            });
            break;
          }
          case Events.OrderCancelled: {
            const d = event.data as OrderCancelledData;
            await db.query(
              `UPDATE invoices SET status = 'void'
                WHERE reference_type = 'order' AND reference_id = $1 AND status = 'unpaid'`,
              [d.orderId],
            );
            break;
          }
          default:
            logger.warn({ type: event.type }, 'Unhandled event type');
        }
      });
      if (!handled) logger.info({ eventId: event.id }, 'Duplicate event skipped');
    },
  );
}

/** Generates rent invoices for every active lease for a given month. Idempotent. */
export async function generateRentInvoices(pool: Pool, period: string, ownerId?: string) {
  const params: unknown[] = [`${period}-28`, `${period}-01`];
  let filter = '';
  if (ownerId) {
    params.push(ownerId);
    filter = 'AND owner_id = $3';
  }
  const { rows } = await pool.query(
    `SELECT * FROM lease_billing
      WHERE active AND start_date <= $1 AND (end_date IS NULL OR end_date >= $2) ${filter}`,
    params,
  );
  let created = 0;
  for (const lb of rows) {
    const inv = await createInvoice(pool, {
      ownerId: lb.owner_id,
      customerId: lb.tenant_user_id,
      referenceType: 'lease',
      referenceId: lb.lease_id,
      kind: 'rent',
      period,
      description: `Rent ${period}`,
      amount: lb.monthly_rent,
      currency: lb.currency,
      dueDate: dueDateFor(period, lb.due_day),
    });
    if (inv) created++;
  }
  return { period, activeLeases: rows.length, created };
}
