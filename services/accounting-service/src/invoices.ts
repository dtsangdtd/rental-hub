import { Queryable } from '@rental/common';

export interface NewInvoice {
  ownerId: string | null;
  customerId: string | null;
  referenceType: 'lease' | 'order' | 'manual';
  referenceId: string | null;
  kind: 'rent' | 'deposit' | 'order' | 'other';
  period?: string | null;
  description: string;
  amount: number;
  currency: string;
  dueDate: string; // YYYY-MM-DD
  metadata?: unknown;
}

/**
 * Single place that inserts invoices. Rent invoices are idempotent per (lease, period):
 * returns null if the invoice already exists.
 */
export async function createInvoice(db: Queryable, inv: NewInvoice) {
  const { rows } = await db.query(
    `INSERT INTO invoices (number, owner_id, customer_id, reference_type, reference_id, kind, period,
                           description, amount, currency, due_date, metadata)
     VALUES ('INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      inv.ownerId,
      inv.customerId,
      inv.referenceType,
      inv.referenceId,
      inv.kind,
      inv.period ?? null,
      inv.description,
      inv.amount,
      inv.currency,
      inv.dueDate,
      inv.metadata ? JSON.stringify(inv.metadata) : null,
    ],
  );
  return rows[0] ?? null;
}

export interface SyncBillParams {
  ownerId: string;
  leaseId?: string | null;
  customerId?: string | null;
  period: string; // 'YYYY-MM'
  description: string;
  amount: number;
  currency: string;
  dueDate?: string | null;
  metadata?: unknown;
}

/**
 * Creates or updates an invoice for a rental bill.
 * If an unpaid invoice exists for the lease and period, updates amount and metadata.
 * If already paid, preserves paid status and updates metadata.
 * If none exists, creates a new one.
 */
export async function syncBillInvoice(db: Queryable, params: SyncBillParams) {
  let customerId = params.customerId ?? null;
  let dueDay = 5;

  if (params.leaseId) {
    const { rows: lbRows } = await db.query(
      'SELECT tenant_user_id, due_day FROM lease_billing WHERE lease_id = $1',
      [params.leaseId],
    );
    if (lbRows[0]) {
      if (!customerId && lbRows[0].tenant_user_id) {
        customerId = lbRows[0].tenant_user_id;
      }
      if (lbRows[0].due_day) {
        dueDay = lbRows[0].due_day;
      }
    }

    const { rows: existing } = await db.query(
      `SELECT * FROM invoices
        WHERE reference_type = 'lease' AND reference_id = $1 AND period = $2 AND owner_id = $3`,
      [params.leaseId, params.period, params.ownerId],
    );

    if (existing[0]) {
      const inv = existing[0];
      if (inv.status === 'unpaid') {
        const { rows: updated } = await db.query(
          `UPDATE invoices
              SET amount = $1, description = $2,
                  metadata = COALESCE($3, metadata),
                  customer_id = COALESCE($4, customer_id),
                  due_date = COALESCE($5, due_date)
            WHERE id = $6
            RETURNING *`,
          [
            params.amount,
            params.description,
            params.metadata ? JSON.stringify(params.metadata) : null,
            customerId,
            params.dueDate ?? null,
            inv.id,
          ],
        );
        return updated[0];
      }

      const { rows: updated } = await db.query(
        `UPDATE invoices SET metadata = COALESCE($1, metadata) WHERE id = $2 RETURNING *`,
        [params.metadata ? JSON.stringify(params.metadata) : null, inv.id],
      );
      return updated[0];
    }
  }

  const dueDate = params.dueDate ?? dueDateFor(params.period, dueDay);
  const { rows: created } = await db.query(
    `INSERT INTO invoices (number, owner_id, customer_id, reference_type, reference_id, kind, period,
                           description, amount, currency, due_date, metadata)
     VALUES ('INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      params.ownerId,
      customerId,
      params.leaseId ? 'lease' : 'manual',
      params.leaseId ?? null,
      'rent',
      params.period,
      params.description,
      params.amount,
      params.currency,
      dueDate,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );
  return created[0];
}

/** 'YYYY-MM' + due day -> 'YYYY-MM-DD' */
export const dueDateFor = (period: string, dueDay: number) =>
  `${period}-${String(dueDay).padStart(2, '0')}`;

export const periodOf = (isoDate: string) => isoDate.slice(0, 7);

export interface ProratedRentResult {
  amount: number;
  daysStayed: number;
  dailyRate: number;
  isProrated: boolean;
  cycleStartStr: string;
  cycleEndStr: string;
  stayStartStr: string;
  stayEndStr: string;
}

/**
 * Calculates rent according to actual days stayed in the billing cycle,
 * using the standard 30-day average divisor: dailyRate = monthlyRent / 30.
 *
 * Example (user specified):
 * - Monthly rent: 800,000 VND -> dailyRate = 800,000 / 30 = 26,667 VND/day
 * - Tenant moves in: 15th (e.g. 15/10)
 * - Auto invoice on 5th of next month (e.g. 05/11):
 *   Cycle runs up to end of 4th of next month (04/11) -> 21 days stayed
 * - First month rent = Math.round(26,666.67 * 21) = 560,000 VND
 */
export function calculateProratedRent(
  monthlyRent: number,
  startDateStr: string,
  periodStr: string, // 'YYYY-MM'
  billingDay: number = 5,
  endDateStr?: string | null,
): ProratedRentResult {
  const bDay = Number(billingDay) || 5;
  const [pYear, pMonth] = periodStr.split('-').map(Number);
  const [sYear, sMonth, sDay] = startDateStr.slice(0, 10).split('-').map(Number);
  const startStay = new Date(Date.UTC(sYear, sMonth - 1, sDay));

  let cycleStart: Date;
  let cycleEnd: Date;

  // If viewing/billing the move-in month and move-in day > billingDay:
  // e.g. moved in 15/10 and billing day is 5:
  // First cycle covers from 15/10 to 04/11 (day before billingDay of next month)
  if (sYear === pYear && sMonth === pMonth && sDay > bDay) {
    cycleStart = startStay;
    cycleEnd = new Date(Date.UTC(pYear, pMonth, bDay - 1));
  } else {
    // Cycle ends on (bDay - 1) of pMonth.
    if (bDay <= 1) {
      cycleEnd = new Date(Date.UTC(pYear, pMonth - 1, 0)); // last day of prev month
      cycleStart = new Date(Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth(), 1));
    } else {
      cycleEnd = new Date(Date.UTC(pYear, pMonth - 1, bDay - 1));
      cycleStart = new Date(Date.UTC(pYear, pMonth - 2, bDay));
    }
  }

  const actualStart = startStay > cycleStart ? startStay : cycleStart;
  let actualEnd = cycleEnd;
  if (endDateStr) {
    const [eYear, eMonth, eDay] = endDateStr.slice(0, 10).split('-').map(Number);
    const endStay = new Date(Date.UTC(eYear, eMonth - 1, eDay));
    if (endStay < cycleEnd) {
      actualEnd = endStay;
    }
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const diffMs = actualEnd.getTime() - actualStart.getTime();
  const daysStayed = diffMs >= 0 ? Math.round(diffMs / msPerDay) + 1 : 0;

  const isFullCycle =
    actualStart.getTime() === cycleStart.getTime() && actualEnd.getTime() === cycleEnd.getTime() && daysStayed >= 28;

  const dailyRate = Number(monthlyRent) / 30;

  if (isFullCycle || daysStayed >= 30) {
    return {
      amount: Number(monthlyRent),
      daysStayed: 30,
      dailyRate,
      isProrated: false,
      cycleStartStr: cycleStart.toISOString().slice(0, 10),
      cycleEndStr: cycleEnd.toISOString().slice(0, 10),
      stayStartStr: actualStart.toISOString().slice(0, 10),
      stayEndStr: actualEnd.toISOString().slice(0, 10),
    };
  }

  const amount = Math.round(dailyRate * daysStayed);
  return {
    amount,
    daysStayed,
    dailyRate,
    isProrated: true,
    cycleStartStr: cycleStart.toISOString().slice(0, 10),
    cycleEndStr: cycleEnd.toISOString().slice(0, 10),
    stayStartStr: actualStart.toISOString().slice(0, 10),
    stayEndStr: actualEnd.toISOString().slice(0, 10),
  };
}
