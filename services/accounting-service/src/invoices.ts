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
}

/**
 * Single place that inserts invoices. Rent invoices are idempotent per (lease, period):
 * returns null if the invoice already exists.
 */
export async function createInvoice(db: Queryable, inv: NewInvoice) {
  const { rows } = await db.query(
    `INSERT INTO invoices (number, owner_id, customer_id, reference_type, reference_id, kind, period,
                           description, amount, currency, due_date)
     VALUES ('INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    ],
  );
  return rows[0] ?? null;
}

/** 'YYYY-MM' + due day -> 'YYYY-MM-DD' */
export const dueDateFor = (period: string, dueDay: number) =>
  `${period}-${String(dueDay).padStart(2, '0')}`;

export const periodOf = (isoDate: string) => isoDate.slice(0, 7);
