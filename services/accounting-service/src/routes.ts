import { Router } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import {
  asyncHandler,
  AuthUser,
  badRequest,
  conflict,
  currentUser,
  EventBus,
  Events,
  forbidden,
  InvoicePaidData,
  notFound,
  paginatedResponse,
  parsePagination,
  requireRole,
  transaction,
  validate,
} from '@rental/common';
import { createInvoice, syncBillInvoice } from './invoices';
import { autoGenerateMonthlyInvoices, generateRentInvoices } from './consumers';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');
const money = z.number().positive().multipleOf(0.01);

const manualInvoiceSchema = z.object({
  customerId: uuid.optional(),
  description: z.string().min(1).max(500),
  amount: money,
  currency: z.string().length(3).toUpperCase().default('VND'),
  dueDate: isoDate,
});
const syncBillSchema = z.object({
  leaseId: uuid.optional().nullable(),
  customerId: uuid.optional().nullable(),
  period: period,
  description: z.string().min(1).max(500),
  amount: money,
  currency: z.string().length(3).toUpperCase().default('VND'),
  dueDate: isoDate.optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});
const paymentSchema = z.object({
  amount: money,
  method: z.enum(['cash', 'bank_transfer', 'card', 'ewallet']),
  note: z.string().max(500).optional(),
});
const expenseSchema = z.object({
  propertyId: uuid.optional(),
  category: z.enum(['maintenance', 'utilities', 'tax', 'insurance', 'salary', 'other']),
  description: z.string().min(1).max(500),
  amount: money,
  currency: z.string().length(3).toUpperCase().default('VND'),
  spentOn: isoDate,
});
const invoiceQuery = z.object({
  status: z.enum(['unpaid', 'partial', 'paid', 'void']).optional(),
  kind: z.enum(['rent', 'deposit', 'order', 'other', 'all']).optional(),
  period: period.optional(),
  referenceId: uuid.optional(),
  q: z.string().optional(),
  search: z.string().optional(),
});
const reportQuery = z.object({ from: isoDate, to: isoDate });

/** Row-level visibility of invoices: admin and accountant see all, landlords own, tenants their customer invoices */
function invoiceScope(u: AuthUser, startIndex: number): { sql: string; params: unknown[] } {
  if (u.role === 'admin' || u.role === 'accountant') return { sql: '1=1', params: [] };
  if (u.role === 'tenant') return { sql: `customer_id = $${startIndex}`, params: [u.id] };
  return { sql: `owner_id = $${startIndex}`, params: [u.id] };
}

function canSeeInvoice(u: AuthUser, inv: { owner_id: string | null; customer_id: string | null }) {
  if (u.role === 'admin' || u.role === 'accountant') return true;
  return inv.owner_id === u.id || inv.customer_id === u.id;
}

export function buildRouter(deps: { pool: Pool; bus: EventBus }): Router {
  const { pool, bus } = deps;
  const router = Router();
  const finance = requireRole('admin', 'accountant', 'landlord');

  // ---------- Invoices ----------
  router.get(
    '/invoices',
    asyncHandler(async (req, res) => {
      const q = validate(invoiceQuery, req.query);
      const { page, limit, offset } = parsePagination(req.query);
      const scope = invoiceScope(currentUser(req), 1);
      const params = [...scope.params];
      const where = [scope.sql];
      if (q.status) where.push(`status = $${params.push(q.status)}`);
      if (q.kind && q.kind !== 'all') where.push(`kind = $${params.push(q.kind)}`);
      if (q.period) where.push(`period = $${params.push(q.period)}`);
      if (q.referenceId) where.push(`reference_id = $${params.push(q.referenceId)}`);
      const searchTerm = (q.q || q.search)?.trim();
      if (searchTerm) {
        params.push(`%${searchTerm}%`);
        where.push(`(number ILIKE $${params.length} OR description ILIKE $${params.length})`);
      }

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS total FROM invoices WHERE ${where.join(' AND ')}`,
        params,
      );
      const total = countRes.rows[0]?.total ?? 0;

      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const { rows } = await pool.query(
        `SELECT * FROM invoices WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      res.json(paginatedResponse(rows, total, page, limit));
    }),
  );

  router.get(
    '/invoices/:id',
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
      const inv = rows[0];
      if (!inv) throw notFound('Invoice');
      if (!canSeeInvoice(currentUser(req), inv)) throw forbidden();
      const payments = await pool.query('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at', [id]);
      res.json({ ...inv, payments: payments.rows });
    }),
  );

  router.post(
    '/invoices',
    finance,
    asyncHandler(async (req, res) => {
      const b = validate(manualInvoiceSchema, req.body);
      const user = currentUser(req);
      const inv = await createInvoice(pool, {
        ownerId: user.id,
        customerId: b.customerId ?? null,
        referenceType: 'manual',
        referenceId: null,
        kind: 'other',
        description: b.description,
        amount: b.amount,
        currency: b.currency,
        dueDate: b.dueDate,
      });
      res.status(201).json(inv);
    }),
  );

  router.post(
    '/invoices/generate-rent',
    finance,
    asyncHandler(async (req, res) => {
      const { period: p } = validate(z.object({ period }), req.body);
      const user = currentUser(req);
      const result = await generateRentInvoices(pool, p, user.id);
      res.json(result);
    }),
  );

  router.post(
    '/invoices/auto-generate',
    finance,
    asyncHandler(async (req, res) => {
      const b = validate(z.object({ period: period.optional() }), req.body);
      const user = currentUser(req);
      const result = await autoGenerateMonthlyInvoices(
        pool,
        b.period,
        user.role === 'admin' ? undefined : user.id,
      );
      res.json(result);
    }),
  );

  router.post(
    '/invoices/sync-bill',
    finance,
    asyncHandler(async (req, res) => {
      const b = validate(syncBillSchema, req.body);
      const user = currentUser(req);
      const inv = await syncBillInvoice(pool, {
        ownerId: user.id,
        leaseId: b.leaseId,
        customerId: b.customerId,
        period: b.period,
        description: b.description,
        amount: b.amount,
        currency: b.currency,
        dueDate: b.dueDate,
        metadata: b.metadata,
      });
      res.status(200).json(inv);
    }),
  );

  router.post(
    '/invoices/:id/void',
    finance,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);
      const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
      const inv = rows[0];
      if (!inv) throw notFound('Invoice');
      if (user.role !== 'admin' && inv.owner_id !== user.id) throw forbidden();
      if (inv.amount_paid > 0) throw conflict('INVOICE_HAS_PAYMENTS', 'Cannot void an invoice with payments');
      const updated = await pool.query(`UPDATE invoices SET status = 'void' WHERE id = $1 RETURNING *`, [id]);
      res.json(updated.rows[0]);
    }),
  );

  // ---------- Payments ----------
  router.post(
    '/invoices/:id/payments',
    finance,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const b = validate(paymentSchema, req.body);
      const user = currentUser(req);

      const result = await transaction(pool, async (db) => {
        const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
        const inv = rows[0];
        if (!inv) throw notFound('Invoice');
        if (user.role !== 'admin' && user.role !== 'accountant' && inv.owner_id !== user.id) throw forbidden();
        if (inv.status === 'void' || inv.status === 'paid') {
          throw conflict('INVOICE_CLOSED', `Invoice is ${inv.status}`);
        }
        const remaining = Math.round((inv.amount - inv.amount_paid) * 100) / 100;
        if (b.amount > remaining) throw badRequest(`Amount exceeds remaining balance (${remaining})`);

        const payment = await db.query(
          `INSERT INTO payments (invoice_id, amount, method, note, recorded_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [id, b.amount, b.method, b.note ?? null, user.id],
        );
        const newPaid = Math.round((inv.amount_paid + b.amount) * 100) / 100;
        const status = newPaid >= inv.amount ? 'paid' : 'partial';
        const updated = await db.query(
          'UPDATE invoices SET amount_paid = $2, status = $3 WHERE id = $1 RETURNING *',
          [id, newPaid, status],
        );
        return { invoice: updated.rows[0], payment: payment.rows[0] };
      });

      if (result.invoice.status === 'paid') {
        await bus.publish<InvoicePaidData>(Events.InvoicePaid, {
          invoiceId: result.invoice.id,
          referenceType: result.invoice.reference_type,
          referenceId: result.invoice.reference_id,
          amount: result.invoice.amount,
          currency: result.invoice.currency,
          paidAt: new Date().toISOString(),
        });
      }
      res.status(201).json(result);
    }),
  );

  // ---------- Expenses ----------
  router.get(
    '/expenses',
    finance,
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { page, limit, offset } = parsePagination(req.query);

      const conditions: string[] = [];
      const params: any[] = [];

      if (user.role !== 'admin') {
        params.push(user.id);
        conditions.push(`owner_id = $${params.length}`);
      }

      if (req.query.category && req.query.category !== 'all') {
        params.push(req.query.category);
        conditions.push(`category = $${params.length}`);
      }

      const expSearch = (req.query.search || req.query.q) as string | undefined;
      if (expSearch?.trim()) {
        params.push(`%${expSearch.trim()}%`);
        conditions.push(`description ILIKE $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM expenses ${whereClause}`, params);
      const total = countRes.rows[0]?.total ?? 0;

      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const { rows } = await pool.query(
        `SELECT * FROM expenses ${whereClause} ORDER BY spent_on DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      res.json(paginatedResponse(rows, total, page, limit));
    }),
  );

  router.post(
    '/expenses',
    finance,
    asyncHandler(async (req, res) => {
      const b = validate(expenseSchema, req.body);
      const user = currentUser(req);
      const { rows } = await pool.query(
        `INSERT INTO expenses (owner_id, property_id, category, description, amount, currency, spent_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [user.id, b.propertyId ?? null, b.category, b.description, b.amount, b.currency, b.spentOn, user.id],
      );
      res.status(201).json(rows[0]);
    }),
  );

  // ---------- Reports ----------
  router.get(
    '/reports/summary',
    finance,
    asyncHandler(async (req, res) => {
      const { from, to } = validate(reportQuery, req.query);
      if (from > to) throw badRequest('from must be <= to');
      const user = currentUser(req);
      const ownerParam = user.role === 'admin' || user.role === 'accountant' ? null : user.id;

      const income = await pool.query(
        `SELECT i.currency, i.kind, COALESCE(SUM(p.amount), 0) AS total
           FROM payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.paid_at::date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR i.owner_id = $3)
          GROUP BY i.currency, i.kind`,
        [from, to, ownerParam],
      );
      const expenses = await pool.query(
        `SELECT currency, category, COALESCE(SUM(amount), 0) AS total
           FROM expenses
          WHERE spent_on BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR owner_id = $3)
          GROUP BY currency, category`,
        [from, to, ownerParam],
      );
      const outstanding = await pool.query(
        `SELECT currency, COALESCE(SUM(amount - amount_paid), 0) AS total, COUNT(*) AS count
           FROM invoices
          WHERE status IN ('unpaid', 'partial') AND ($1::uuid IS NULL OR owner_id = $1)
          GROUP BY currency`,
        [ownerParam],
      );

      const byCurrency: Record<string, { income: number; expenses: number; profit: number }> = {};
      const bucket = (c: string) => (byCurrency[c] ??= { income: 0, expenses: 0, profit: 0 });
      for (const r of income.rows) bucket(r.currency).income += r.total;
      for (const r of expenses.rows) bucket(r.currency).expenses += r.total;
      for (const v of Object.values(byCurrency)) v.profit = Math.round((v.income - v.expenses) * 100) / 100;

      res.json({
        from,
        to,
        totals: byCurrency,
        incomeByKind: income.rows,
        expensesByCategory: expenses.rows,
        outstanding: outstanding.rows,
      });
    }),
  );

  return router;
}
