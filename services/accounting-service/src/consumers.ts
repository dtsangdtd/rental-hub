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
  OrderPaidData,
  OrderPlacedData,
  PropertyAutoInvoiceToggledData,
  TenantDebtChargeRequestedData,
} from '@rental/common';
import { calculateProratedRent, createInvoice, dueDateFor, periodOf } from './invoices';

/**
 * Event consumers. Every handler runs inside handleOnce() so redelivered
 * messages are ignored (idempotency).
 */
export async function registerConsumers(pool: Pool, bus: EventBus, logger: Logger) {
  await bus.subscribe(
    'accounting-service.events',
    [
      Events.LeaseCreated,
      Events.LeaseTerminated,
      Events.PropertyAutoInvoiceToggled,
      Events.OrderPlaced,
      Events.OrderPaid,
      Events.OrderCancelled,
      Events.TenantDebtChargeRequested,
    ],
    async (event: DomainEvent) => {
      const handled = await handleOnce(pool, event.id, async (db) => {
        switch (event.type) {
          case Events.LeaseCreated: {
            const d = event.data as LeaseCreatedData;
            await db.query(
              `INSERT INTO lease_billing (lease_id, owner_id, property_id, auto_invoice, auto_invoice_day, tenant_id, tenant_user_id, monthly_rent,
                                          currency, due_day, start_date, end_date)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (lease_id) DO UPDATE SET
                 property_id = EXCLUDED.property_id,
                 auto_invoice = EXCLUDED.auto_invoice,
                 auto_invoice_day = EXCLUDED.auto_invoice_day,
                 monthly_rent = EXCLUDED.monthly_rent,
                 due_day = EXCLUDED.due_day`,
              [
                d.leaseId,
                d.ownerId,
                d.propertyId ?? null,
                d.autoInvoice ?? false,
                d.autoInvoiceDay ?? 5,
                d.tenantId,
                d.tenantUserId,
                d.monthlyRent,
                d.currency,
                d.dueDay,
                d.startDate,
                d.endDate,
              ],
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
            const prorated = calculateProratedRent(
              d.monthlyRent,
              d.startDate,
              period,
              d.autoInvoiceDay || 5,
              d.endDate,
            );
            const desc = prorated.isProrated
              ? `Tiền thuê phòng tháng ${period} (${prorated.daysStayed} ngày, từ ${prorated.stayStartStr} đến ${prorated.stayEndStr})`
              : `Rent ${period}`;
            await createInvoice(db, {
              ownerId: d.ownerId,
              customerId: d.tenantUserId,
              referenceType: 'lease',
              referenceId: d.leaseId,
              kind: 'rent',
              period,
              description: desc,
              amount: prorated.amount,
              currency: d.currency,
              dueDate: d.startDate,
            });
            break;
          }
          case Events.PropertyAutoInvoiceToggled: {
            const d = event.data as PropertyAutoInvoiceToggledData;
            await db.query(
              `UPDATE lease_billing
                  SET auto_invoice = $1,
                      auto_invoice_day = COALESCE($3, auto_invoice_day)
                WHERE property_id = $2`,
              [d.autoInvoice, d.propertyId, d.autoInvoiceDay ?? null],
            );
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

            // Resolve ownerId from event or from property's lease_billing
            let ownerId = d.ownerId ?? null;
            if (!ownerId && d.propertyId) {
              const { rows: lb } = await db.query(
                'SELECT owner_id FROM lease_billing WHERE property_id = $1 LIMIT 1',
                [d.propertyId],
              );
              if (lb[0]?.owner_id) {
                ownerId = lb[0].owner_id;
              }
            }

            const orderRef = d.orderNumber ? `#${d.orderNumber}` : `#${d.orderId.slice(0, 8)}`;
            const customerPart = d.customerName ? ` (${d.customerName}${d.roomNumber ? ' - P.' + d.roomNumber : ''})` : '';
            const itemsCount = d.items?.length ? `${d.items.length} mặt hàng` : 'Đơn hàng';
            const description = `Hóa đơn bán lẻ cửa hàng ${orderRef}${customerPart} - ${itemsCount}`;

            const inv = await createInvoice(db, {
              ownerId,
              customerId: d.customerId && d.customerId !== '00000000-0000-0000-0000-000000000000' ? d.customerId : null,
              referenceType: 'order',
              referenceId: d.orderId,
              kind: 'order',
              description,
              amount: d.total,
              currency: d.currency,
              dueDate: today,
              metadata: {
                orderId: d.orderId,
                orderNumber: d.orderNumber,
                paymentMethod: d.paymentMethod,
                propertyId: d.propertyId,
                hubId: d.hubId,
                customerName: d.customerName,
                roomNumber: d.roomNumber,
                items: d.items,
              },
            });

            // If this order is already paid (e.g. POS Cash, POS VietQR, online paid):
            if (inv && d.isPaid) {
              const method = d.paidMethod || (d.paymentMethod === 'VIETQR' ? 'bank_transfer' : 'cash');
              const recordedBy = d.recordedBy || ownerId || inv.id;
              await db.query(
                `INSERT INTO payments (invoice_id, amount, method, note, recorded_by, paid_at)
                 VALUES ($1, $2, $3, $4, $5, now())`,
                [inv.id, d.total, method, `Thanh toán tại quầy đơn ${orderRef} qua ${d.paymentMethod || method}`, recordedBy],
              );
              await db.query(
                `UPDATE invoices SET amount_paid = $1, status = 'paid' WHERE id = $2`,
                [d.total, inv.id],
              );
            }
            break;
          }
          case Events.OrderPaid: {
            const d = event.data as OrderPaidData;
            const { rows: invRows } = await db.query(
              `SELECT * FROM invoices WHERE reference_type = 'order' AND reference_id = $1 FOR UPDATE`,
              [d.orderId],
            );
            const inv = invRows[0];
            if (inv && inv.status !== 'paid') {
              const method = d.paidMethod || (d.paymentMethod === 'VIETQR' ? 'bank_transfer' : 'cash');
              const recordedBy = d.recordedBy || inv.owner_id || inv.id;
              await db.query(
                `INSERT INTO payments (invoice_id, amount, method, note, recorded_by, paid_at)
                 VALUES ($1, $2, $3, $4, $5, now())`,
                [inv.id, d.amount, method, `Thanh toán đơn hàng ${d.orderNumber ? '#' + d.orderNumber : ''} (${d.paymentMethod || method})`, recordedBy],
              );
              await db.query(
                `UPDATE invoices SET amount_paid = $1, status = 'paid' WHERE id = $2`,
                [d.amount, inv.id],
              );
            }
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
          case Events.TenantDebtChargeRequested: {
            const d = event.data as TenantDebtChargeRequestedData;
            const { rows: lb } = await db.query(
              'SELECT * FROM lease_billing WHERE lease_id = $1',
              [d.contractId],
            );
            const ownerId = lb[0]?.owner_id ?? d.propertyId;
            const customerId = lb[0]?.tenant_user_id ?? null;
            const dueDay = lb[0]?.due_day ?? 5;
            await createInvoice(db, {
              ownerId,
              customerId,
              referenceType: 'order',
              referenceId: d.orderId,
              kind: 'order',
              period: d.period,
              description: d.description,
              amount: d.amount,
              currency: d.currency,
              dueDate: dueDateFor(d.period, dueDay),
              metadata: {
                orderId: d.orderId,
                orderNumber: d.orderNumber,
                tenantId: d.tenantId,
                contractId: d.contractId,
                propertyId: d.propertyId,
                period: d.period,
              },
            });
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
    const prorated = calculateProratedRent(
      Number(lb.monthly_rent),
      lb.start_date,
      period,
      lb.auto_invoice_day || 5,
      lb.end_date,
    );
    if (prorated.daysStayed <= 0) continue;

    const desc = prorated.isProrated
      ? `Tiền thuê phòng tháng ${period} (${prorated.daysStayed} ngày, từ ${prorated.stayStartStr} đến ${prorated.stayEndStr})`
      : `Rent ${period}`;

    const inv = await createInvoice(pool, {
      ownerId: lb.owner_id,
      customerId: lb.tenant_user_id,
      referenceType: 'lease',
      referenceId: lb.lease_id,
      kind: 'rent',
      period,
      description: desc,
      amount: prorated.amount,
      currency: lb.currency,
      dueDate: dueDateFor(period, lb.due_day),
    });
    if (inv) created++;
  }
  return { period, activeLeases: rows.length, created };
}

/**
 * Automatically generates rent invoices on the configured billing day of each month
 * for all active leases where the building has auto_invoice enabled. Idempotent.
 */
export async function autoGenerateMonthlyInvoices(
  pool: Pool,
  targetPeriod?: string,
  ownerId?: string,
  currentDay?: number,
) {
  const now = new Date();
  const period = targetPeriod ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = currentDay ?? (targetPeriod ? 31 : now.getDate());
  const params: unknown[] = [`${period}-28`, `${period}-01`, period, day];
  let ownerClause = '';
  if (ownerId) {
    params.push(ownerId);
    ownerClause = `AND lb.owner_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT lb.* FROM lease_billing lb
      WHERE lb.active = TRUE
        AND lb.auto_invoice = TRUE
        AND lb.auto_invoice_day <= $4
        AND lb.start_date <= $1
        AND (lb.end_date IS NULL OR lb.end_date >= $2)
        ${ownerClause}
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
           WHERE i.reference_type = 'lease'
             AND i.reference_id = lb.lease_id
             AND i.period = $3
             AND i.kind = 'rent'
        )`,
    params,
  );

  let created = 0;
  for (const lb of rows) {
    const prorated = calculateProratedRent(
      Number(lb.monthly_rent),
      lb.start_date,
      period,
      lb.auto_invoice_day || 5,
      lb.end_date,
    );
    if (prorated.daysStayed <= 0) continue;

    const desc = prorated.isProrated
      ? `Tiền thuê phòng tháng ${period} (${prorated.daysStayed} ngày, từ ${prorated.stayStartStr} đến ${prorated.stayEndStr})`
      : `Tiền thuê phòng tháng ${period}`;

    const inv = await createInvoice(pool, {
      ownerId: lb.owner_id,
      customerId: lb.tenant_user_id,
      referenceType: 'lease',
      referenceId: lb.lease_id,
      kind: 'rent',
      period,
      description: desc,
      amount: prorated.amount,
      currency: lb.currency,
      dueDate: dueDateFor(period, lb.due_day),
    });
    if (inv) created++;
  }
  return { period, eligible: rows.length, created };
}

