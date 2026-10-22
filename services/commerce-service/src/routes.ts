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
  isUniqueViolation,
  notFound,
  OrderCancelledData,
  OrderPlacedData,
  requireRole,
  transaction,
  validate,
} from '@rental/common';

const uuid = z.string().uuid();

const productSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(50).default('general'),
  price: z.number().nonnegative().multipleOf(0.01),
  currency: z.string().length(3).toUpperCase().default('VND'),
  stock: z.number().int().nonnegative().default(0),
});
const productPatchSchema = productSchema.omit({ sku: true }).partial().extend({
  active: z.boolean().optional(),
});
const orderSchema = z.object({
  items: z
    .array(z.object({ productId: uuid, quantity: z.number().int().positive().max(100) }))
    .min(1)
    .max(50),
  note: z.string().max(500).optional(),
});
const productQuery = z.object({
  category: z.string().optional(),
  q: z.string().max(100).optional(),
});

const isAdmin = (u: AuthUser) => u.role === 'admin';
const canManageOrders = (u: AuthUser) => u.role === 'admin' || u.role === 'accountant';

export function buildRouter(deps: { pool: Pool; bus: EventBus }): Router {
  const { pool, bus } = deps;
  const router = Router();
  const seller = requireRole('admin', 'landlord');

  // ---------- Products (catalog visible to all authenticated users) ----------
  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      const q = validate(productQuery, req.query);
      const params: unknown[] = [];
      const where = ['active'];
      if (q.category) where.push(`category = $${params.push(q.category)}`);
      if (q.q) where.push(`name ILIKE $${params.push(`%${q.q}%`)}`);
      const { rows } = await pool.query(
        `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
        params,
      );
      res.json({ items: rows });
    }),
  );

  router.get(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [validate(uuid, req.params.id)]);
      if (!rows[0]) throw notFound('Product');
      res.json(rows[0]);
    }),
  );

  router.post(
    '/products',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(productSchema, req.body);
      try {
        const { rows } = await pool.query(
          `INSERT INTO products (seller_id, sku, name, description, category, price, currency, stock)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [currentUser(req).id, b.sku, b.name, b.description ?? null, b.category, b.price, b.currency, b.stock],
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('SKU_EXISTS', 'SKU already exists');
        throw err;
      }
    }),
  );

  router.patch(
    '/products/:id',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const b = validate(productPatchSchema, req.body);
      const user = currentUser(req);
      const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
      if (!rows[0]) throw notFound('Product');
      if (!isAdmin(user) && rows[0].seller_id !== user.id) throw forbidden();
      const updated = await pool.query(
        `UPDATE products SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           category = COALESCE($4, category),
           price = COALESCE($5, price),
           currency = COALESCE($6, currency),
           stock = COALESCE($7, stock),
           active = COALESCE($8, active)
         WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.description ?? null, b.category ?? null, b.price ?? null, b.currency ?? null, b.stock ?? null, b.active ?? null],
      );
      res.json(updated.rows[0]);
    }),
  );

  // ---------- Orders ----------
  router.get(
    '/orders',
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { rows } = canManageOrders(user)
        ? await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500')
        : await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [user.id]);
      res.json({ items: rows });
    }),
  );

  router.get(
    '/orders/:id',
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);
      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      const order = rows[0];
      if (!order) throw notFound('Order');
      if (!canManageOrders(user) && order.customer_id !== user.id) throw forbidden();
      const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
      res.json({ ...order, items: items.rows });
    }),
  );

  router.post(
    '/orders',
    asyncHandler(async (req, res) => {
      const b = validate(orderSchema, req.body);
      const user = currentUser(req);
      const ids = b.items.map((i) => i.productId);
      if (new Set(ids).size !== ids.length) throw badRequest('Duplicate productId in items');

      const { order, event } = await transaction(pool, async (db) => {
        // Lock product rows in a stable order to avoid deadlocks
        const { rows: products } = await db.query(
          'SELECT * FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
          [ids],
        );
        const byId = new Map(products.map((p) => [p.id, p]));
        let total = 0;
        let currency: string | undefined;
        const lines: OrderPlacedData['items'] = [];
        for (const item of b.items) {
          const p = byId.get(item.productId);
          if (!p || !p.active) throw notFound(`Product ${item.productId}`);
          if (p.stock < item.quantity) {
            throw conflict('OUT_OF_STOCK', `Not enough stock for ${p.name} (available ${p.stock})`);
          }
          if (currency && currency !== p.currency) throw badRequest('All items must use the same currency');
          currency = p.currency;
          total += p.price * item.quantity;
          lines.push({ productId: p.id, name: p.name, quantity: item.quantity, unitPrice: p.price });
        }
        total = Math.round(total * 100) / 100;

        const orderRes = await db.query(
          `INSERT INTO orders (customer_id, total, currency, note) VALUES ($1, $2, $3, $4) RETURNING *`,
          [user.id, total, currency, b.note ?? null],
        );
        const o = orderRes.rows[0];
        for (const l of lines) {
          await db.query(
            `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity) VALUES ($1, $2, $3, $4, $5)`,
            [o.id, l.productId, l.name, l.unitPrice, l.quantity],
          );
          await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [l.productId, l.quantity]);
        }
        const data: OrderPlacedData = { orderId: o.id, customerId: user.id, total, currency: currency!, items: lines };
        return { order: { ...o, items: lines }, event: data };
      });

      await bus.publish(Events.OrderPlaced, event);
      res.status(201).json(order);
    }),
  );

  router.post(
    '/orders/:id/cancel',
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);
      const order = await transaction(pool, async (db) => {
        const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
        const o = rows[0];
        if (!o) throw notFound('Order');
        if (!canManageOrders(user) && o.customer_id !== user.id) throw forbidden();
        if (o.status !== 'pending') throw conflict('ORDER_NOT_PENDING', `Order is ${o.status}`);
        const items = await db.query('SELECT product_id, quantity FROM order_items WHERE order_id = $1', [id]);
        for (const it of items.rows) {
          await db.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [it.product_id, it.quantity]);
        }
        const updated = await db.query(
          `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
          [id],
        );
        return updated.rows[0];
      });
      await bus.publish<OrderCancelledData>(Events.OrderCancelled, { orderId: order.id, customerId: order.customer_id });
      res.json(order);
    }),
  );

  router.post(
    '/orders/:id/fulfill',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const { rows } = await pool.query(
        `UPDATE orders SET status = 'fulfilled', updated_at = now() WHERE id = $1 AND status = 'paid' RETURNING *`,
        [id],
      );
      if (!rows[0]) throw conflict('ORDER_NOT_PAID', 'Only paid orders can be fulfilled');
      res.json(rows[0]);
    }),
  );

  return router;
}
