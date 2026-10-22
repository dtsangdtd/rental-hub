import { Pool } from 'pg';
import { DomainEvent, EventBus, Events, handleOnce, InvoicePaidData, Logger } from '@rental/common';

export async function registerConsumers(pool: Pool, bus: EventBus, logger: Logger) {
  await bus.subscribe('commerce-service.events', [Events.InvoicePaid], async (event: DomainEvent) => {
    await handleOnce(pool, event.id, async (db) => {
      if (event.type !== Events.InvoicePaid) return;
      const d = event.data as InvoicePaidData;
      if (d.referenceType !== 'order' || !d.referenceId) return;
      const res = await db.query(
        `UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [d.referenceId],
      );
      logger.info({ orderId: d.referenceId, updated: res.rowCount }, 'Order marked paid');
    });
  });
}
