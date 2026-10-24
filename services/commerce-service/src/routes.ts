import { Response, Router } from 'express';
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
  GroceryOrderCreatedData,
  isUniqueViolation,
  notFound,
  NotificationLandlordAlertData,
  OrderCancelledData,
  OrderPaidData,
  OrderPlacedData,
  paginatedResponse,
  parsePagination,
  requireRole,
  TenantDebtChargeRequestedData,
  transaction,
  validate,
} from '@rental/common';
import { allocateStockFIFO, BatchAllocation } from './fifo-allocator';
import { dispatchLandlordNotifications } from './notification-dispatcher';

const uuid = z.string().uuid();

const productSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().min(1).max(50).default('general'),
  categoryId: uuid.optional(),
  baseUom: z.string().max(50).default('Cái'),
  price: z.number().nonnegative().multipleOf(0.01),
  currency: z.string().length(3).toUpperCase().default('VND'),
  stock: z.number().int().nonnegative().default(0),
  isCombo: z.boolean().default(false),
  imageUrl: z.string().max(2000).optional(),
  barcode: z.string().max(100).optional(),
  minAlertThreshold: z.number().int().nonnegative().default(10),
});

const productPatchSchema = productSchema.omit({ sku: true }).partial().extend({
  active: z.boolean().optional(),
});

const productUomSchema = z.object({
  uomName: z.string().min(1).max(50),
  conversionFactor: z.number().int().min(1).default(1),
  retailPrice: z.number().nonnegative().multipleOf(0.01),
  wholesalePrice: z.number().nonnegative().multipleOf(0.01).optional(),
  barcode: z.string().max(100).optional(),
  isDefault: z.boolean().default(false),
});

const productQuery = z.object({
  category: z.string().optional(),
  categoryId: uuid.optional(),
  propertyId: uuid.optional(),
  hubId: uuid.optional(),
  q: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
  all: z.enum(['true', 'false']).optional(),
  isCombo: z.enum(['true', 'false']).optional(),
});

const orderSchema = z.object({
  items: z
    .array(z.object({ productId: uuid, quantity: z.number().int().positive().max(100) }))
    .min(1)
    .max(50),
  note: z.string().max(500).optional(),
});

const checkoutItemSchema = z.object({
  productId: uuid,
  uomId: uuid.optional(),
  quantity: z.number().int().positive().max(100),
});

const checkoutSchema = z.object({
  customerType: z.enum(['TENANT', 'RETAIL']).default('TENANT'),
  propertyId: uuid.optional().nullable(),
  roomNumber: z.string().max(50).optional().nullable(),
  recipientAddress: z.string().max(500).optional().nullable(),
  recipientName: z.string().min(1).max(150),
  recipientPhone: z.string().min(8).max(50),
  deliveryType: z.enum(['ROOM_DELIVERY', 'LOBBY_PICKUP', 'STANDARD']).default('ROOM_DELIVERY'),
  paymentMethod: z.enum(['DEBT_ADDED_TO_RENT', 'VIETQR', 'COD']).default('DEBT_ADDED_TO_RENT'),
  note: z.string().max(500).optional(),
  items: z.array(checkoutItemSchema).min(1).max(50),
});

const importBatchSchema = z.object({
  hubId: uuid,
  productId: uuid,
  batchNumber: z.string().min(1).max(100),
  mfgDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costPrice: z.number().nonnegative().multipleOf(0.01).default(0),
  quantity: z.number().int().positive(),
});

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cat'
  );
}

const categoryCreateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().max(100).optional(),
  iconName: z.string().max(50).default('package'),
  sortOrder: z.number().int().default(0),
  propertyId: uuid.optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

const categoryPatchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().max(100).optional(),
  iconName: z.string().max(50).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  description: z.string().max(500).optional().nullable(),
});

const posCheckoutSchema = z.object({
  hubId: uuid.optional().nullable(),
  customerType: z.enum(['RETAIL', 'TENANT']).default('RETAIL'),
  roomNumber: z.string().max(50).optional().nullable(),
  recipientName: z.string().max(150).optional().nullable(),
  recipientPhone: z.string().max(50).optional().nullable(),
  paymentMethod: z.enum(['CASH', 'VIETQR', 'DEBT_ADDED_TO_RENT']).default('CASH'),
  cashGiven: z.number().nonnegative().optional().nullable(),
  items: z
    .array(
      z.object({
        productId: uuid,
        uomId: uuid.optional().nullable(),
        quantity: z.number().int().positive().max(100),
      }),
    )
    .min(1),
  note: z.string().max(500).optional().nullable(),
});

const barcodeImportSchema = z.object({
  hubId: uuid,
  barcode: z.string().min(1).max(100),
  quantity: z.number().int().positive(),
  batchNumber: z.string().max(100).optional().nullable(),
  expDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costPrice: z.number().nonnegative().multipleOf(0.01).default(0),
  mfgDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

const canManageOrders = (u: AuthUser) => u.role === 'admin' || u.role === 'accountant' || u.role === 'landlord';

// Active SSE connections for realtime landlord sound & popup alerts
const sseClients = new Set<Response>();

export function broadcastOrderEvent(eventData: unknown) {
  const payload = `event: NEW_ORDER\ndata: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function getOrCreateHub(pool: Pool, propertyId: string): Promise<string> {
  const { rows } = await pool.query('SELECT id FROM inventory_hubs WHERE property_id = $1 LIMIT 1', [propertyId]);
  if (rows[0]) return rows[0].id;
  const insert = await pool.query(
    `INSERT INTO inventory_hubs (property_id, name, address)
     VALUES ($1, 'Kho Mini-Hub Tòa Nhà', 'Tại sảnh/tầng 1 tòa nhà') RETURNING id`,
    [propertyId],
  );
  return insert.rows[0].id;
}

async function validateTenantWithPropertyService(propertyId: string, roomNumber: string, phoneNumber: string) {
  const propertyServiceUrl = process.env.PROPERTY_SERVICE_URL || 'http://localhost:4002';
  try {
    const res = await fetch(`${propertyServiceUrl}/internal/contracts/validate-tenant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, roomNumber, phoneNumber }),
    });
    if (!res.ok) {
      return { isValid: false, reason: 'SERVICE_ERROR', message: 'Không thể kết nối dịch vụ xác thực tòa nhà' };
    }
    return (await res.json()) as {
      isValid: boolean;
      reason?: string;
      message?: string;
      contractId?: string;
      tenantId?: string;
      tenantName?: string;
      monthlyRent?: number;
      deposit?: number;
      currency?: string;
      landlordUserId?: string;
      zaloWebhookUrl?: string | null;
      zaloGroupId?: string | null;
      telegramChatId?: string | null;
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isValid: false, reason: 'CONNECTION_ERROR', message: `Lỗi kết nối property-service: ${msg}` };
  }
}

export function buildRouter(deps: { pool: Pool; bus: EventBus }): Router {
  const { pool, bus } = deps;
  const router = Router();
  const seller = requireRole('admin', 'landlord');

  // ---------- Grocery Categories CRUD ----------
  router.get(
    '/categories',
    asyncHandler(async (req, res) => {
      const propertyId = req.query.propertyId as string | undefined;
      const params: unknown[] = [];
      let where = 'WHERE is_active';
      if (propertyId) {
        params.push(propertyId);
        where += ` AND (property_id = $${params.length} OR property_id IS NULL)`;
      }
      const { rows } = await pool.query(
        `SELECT * FROM grocery_categories ${where} ORDER BY sort_order ASC, name ASC`,
        params,
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/categories',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(categoryCreateSchema, req.body);
      const user = currentUser(req);
      let targetSlug = b.slug?.trim() || slugify(b.name);
      const slugCheck = await pool.query('SELECT id FROM grocery_categories WHERE slug = $1', [targetSlug]);
      if (slugCheck.rows.length > 0) {
        targetSlug = `${targetSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      const { rows } = await pool.query(
        `INSERT INTO grocery_categories (name, slug, icon_name, sort_order, property_id, created_by, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [b.name.trim(), targetSlug, b.iconName, b.sortOrder, b.propertyId ?? null, user.id, b.description ?? null],
      );
      res.status(201).json(rows[0]);
    }),
  );

  router.patch(
    '/categories/:id',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const b = validate(categoryPatchSchema, req.body);
      const user = currentUser(req);
      const existing = await pool.query('SELECT created_by FROM grocery_categories WHERE id = $1', [id]);
      if (!existing.rows[0]) throw notFound('Category');
      if (user.role !== 'admin' && existing.rows[0].created_by && existing.rows[0].created_by !== user.id) {
        throw forbidden('Bạn chỉ có quyền chỉnh sửa danh mục do chính bạn tạo ra.');
      }
      if (user.role !== 'admin' && !existing.rows[0].created_by) {
        throw forbidden('Danh mục mặc định của hệ thống chỉ Quản trị viên mới được sửa.');
      }

      const { rows } = await pool.query(
        `UPDATE grocery_categories SET
           name = COALESCE($2, name),
           slug = COALESCE($3, slug),
           icon_name = COALESCE($4, icon_name),
           sort_order = COALESCE($5, sort_order),
           is_active = COALESCE($6, is_active),
           description = COALESCE($7, description)
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.name?.trim() ?? null,
          b.slug?.trim() ?? null,
          b.iconName ?? null,
          b.sortOrder ?? null,
          b.isActive ?? null,
          b.description ?? null,
        ],
      );
      if (!rows[0]) throw notFound('Category');
      res.json(rows[0]);
    }),
  );

  router.delete(
    '/categories/:id',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);
      const existing = await pool.query('SELECT created_by FROM grocery_categories WHERE id = $1', [id]);
      if (!existing.rows[0]) throw notFound('Category');
      if (user.role !== 'admin' && existing.rows[0].created_by && existing.rows[0].created_by !== user.id) {
        throw forbidden('Bạn chỉ có quyền xóa danh mục do chính bạn tạo ra.');
      }
      if (user.role !== 'admin' && !existing.rows[0].created_by) {
        throw forbidden('Danh mục mặc định của hệ thống không thể xóa.');
      }

      const prodCount = await pool.query(
        'SELECT count(*)::int as count FROM products WHERE category_id = $1',
        [id],
      );
      if ((prodCount.rows[0]?.count ?? 0) > 0) {
        await pool.query('UPDATE grocery_categories SET is_active = FALSE WHERE id = $1', [id]);
        res.json({ message: 'Danh mục đã có sản phẩm liên kết (Foreign Key), đã chuyển sang trạng thái ẩn.' });
        return;
      }
      await pool.query('DELETE FROM grocery_categories WHERE id = $1', [id]);
      res.json({ message: 'Đã xóa danh mục thành công.' });
    }),
  );

  // ---------- Hubs (Tòa nhà / Mini-Hub / Cửa hàng) ----------
  router.get(
    '/hubs',
    asyncHandler(async (req, res) => {
      const propertyId = req.query.propertyId as string | undefined;
      const showAll = req.query.all === 'true';
      const params: unknown[] = [];
      let where = showAll ? 'WHERE 1=1' : 'WHERE h.is_active';
      if (propertyId) {
        params.push(propertyId);
        where += ` AND h.property_id = $${params.length}`;
      }
      const { rows } = await pool.query(
        `SELECT h.*,
                COUNT(DISTINCT ib.product_id)::int AS total_products,
                COALESCE(SUM(ib.remaining_qty), 0)::int AS total_inventory_qty
           FROM inventory_hubs h
      LEFT JOIN inventory_batches ib ON ib.hub_id = h.id AND ib.remaining_qty > 0
          ${where}
       GROUP BY h.id
       ORDER BY h.created_at DESC`,
        params,
      );
      res.json({ items: rows });
    }),
  );

  router.post(
    '/hubs',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(
        z.object({
          propertyId: uuid,
          name: z.string().min(1).max(255),
          address: z.string().min(1),
          managerUserId: uuid.optional().nullable(),
        }),
        req.body,
      );
      const user = currentUser(req);
      const { rows } = await pool.query(
        `INSERT INTO inventory_hubs (property_id, name, address, manager_user_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [b.propertyId, b.name.trim(), b.address.trim(), b.managerUserId ?? user.id],
      );
      res.status(201).json(rows[0]);
    }),
  );

  router.patch(
    '/hubs/:id',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const b = validate(
        z.object({
          propertyId: uuid.optional(),
          name: z.string().min(1).max(255).optional(),
          address: z.string().min(1).optional(),
          managerUserId: uuid.optional().nullable(),
          isActive: z.boolean().optional(),
        }),
        req.body,
      );
      const { rows } = await pool.query(
        `UPDATE inventory_hubs SET
           name = COALESCE($2, name),
           address = COALESCE($3, address),
           property_id = COALESCE($4, property_id),
           manager_user_id = COALESCE($5, manager_user_id),
           is_active = COALESCE($6, is_active)
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.name?.trim() ?? null,
          b.address?.trim() ?? null,
          b.propertyId ?? null,
          b.managerUserId ?? null,
          b.isActive ?? null,
        ],
      );
      if (!rows[0]) throw notFound('Hub / Cửa hàng');
      res.json(rows[0]);
    }),
  );

  router.delete(
    '/hubs/:id',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      await pool.query('UPDATE inventory_hubs SET is_active = FALSE WHERE id = $1', [id]);
      res.json({ message: 'Đã tạm ngưng hoạt động cửa hàng thành công.' });
    }),
  );

  // ---------- Products (Storefront Catalog with Multi-UOM & Live Hub Stock) ----------
  router.get(
    '/products',
    asyncHandler(async (req, res) => {
      const q = validate(productQuery, req.query);
      const { page, limit, offset } = parsePagination(req.query);

      const params: unknown[] = [];
      const where: string[] = [];
      if (q.all !== 'true') {
        where.push('p.active');
      }
      if (q.category && q.category !== 'all') {
        where.push(`p.category = $${params.push(q.category)}`);
      }
      if (q.categoryId) {
        where.push(`p.category_id = $${params.push(q.categoryId)}`);
      }
      if (q.isCombo !== undefined) {
        where.push(`p.is_combo = $${params.push(q.isCombo === 'true')}`);
      }

      const searchTerm = (q.q || q.search)?.trim();
      if (searchTerm) {
        const idx = params.push(`%${searchTerm}%`);
        where.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.category ILIKE $${idx} OR p.description ILIKE $${idx})`);
      }
      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS total FROM products p ${whereClause}`,
        params,
      );
      const total = countRes.rows[0]?.total ?? 0;

      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const { rows: products } = await pool.query(
        `SELECT p.*,
                COALESCE(gc.name, p.category) AS category_name,
                gc.slug AS category_slug,
                gc.icon_name AS category_icon,
                gc.created_by AS category_created_by
           FROM products p
      LEFT JOIN grocery_categories gc ON gc.id = p.category_id
          ${whereClause}
       ORDER BY p.created_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      // Attach UOMs for each product
      if (products.length > 0) {
        const productIds = products.map((p) => p.id);
        const { rows: uoms } = await pool.query(
          `SELECT * FROM product_uoms WHERE product_id = ANY($1) ORDER BY conversion_factor ASC`,
          [productIds],
        );
        const uomMap = new Map<string, unknown[]>();
        for (const u of uoms) {
          const list = uomMap.get(u.product_id) || [];
          list.push(u);
          uomMap.set(u.product_id, list);
        }

        // Attach Hub live stock if hubId or propertyId provided
        let hubIdToUse = q.hubId;
        if (!hubIdToUse && q.propertyId) {
          const hubRes = await pool.query('SELECT id FROM inventory_hubs WHERE property_id = $1 LIMIT 1', [q.propertyId]);
          hubIdToUse = hubRes.rows[0]?.id;
        }

        const stockMap = new Map<string, number>();
        if (hubIdToUse) {
          const { rows: batchStocks } = await pool.query(
            `SELECT product_id, SUM(remaining_qty)::int AS available_qty
               FROM inventory_batches
              WHERE hub_id = $1 AND remaining_qty > 0
              GROUP BY product_id`,
            [hubIdToUse],
          );
          for (const s of batchStocks) {
            stockMap.set(s.product_id, Number(s.available_qty));
          }
        }

        for (const p of products) {
          p.uoms = uomMap.get(p.id) || [];
          p.hub_stock = stockMap.get(p.id) ?? Number(p.stock);
        }
      }

      res.json(paginatedResponse(products, total, page, limit));
    }),
  );

  router.get(
    '/products/lookup-barcode',
    asyncHandler(async (req, res) => {
      const code = ((req.query.code as string) || '').trim();
      if (!code) throw badRequest('Mã vạch không được để trống');
      const hubId = req.query.hubId as string | undefined;

      // 1. First look up product_uoms by barcode
      let matchedUomRow: any = null;
      let matchedProductId: string | null = null;

      const uomMatch = await pool.query(
        `SELECT u.*, p.id as p_id
           FROM product_uoms u
           JOIN products p ON p.id = u.product_id
          WHERE u.barcode = $1 AND p.active
          LIMIT 1`,
        [code],
      );

      if (uomMatch.rows.length > 0) {
        matchedUomRow = uomMatch.rows[0];
        matchedProductId = matchedUomRow.p_id;
      } else {
        // 2. Look up products by barcode or SKU
        const prodMatch = await pool.query(
          `SELECT id FROM products WHERE (barcode = $1 OR sku ILIKE $1) AND active LIMIT 1`,
          [code],
        );
        if (prodMatch.rows.length > 0) {
          matchedProductId = prodMatch.rows[0].id;
        }
      }

      if (!matchedProductId) {
        throw notFound(`Không tìm thấy sản phẩm khớp mã vạch: "${code}"`);
      }

      // Load full product details
      const { rows: pRows } = await pool.query(
        `SELECT p.*,
                COALESCE(gc.name, p.category) AS category_name,
                gc.slug AS category_slug
           FROM products p
      LEFT JOIN grocery_categories gc ON gc.id = p.category_id
          WHERE p.id = $1`,
        [matchedProductId],
      );
      const prod = pRows[0];

      const { rows: uoms } = await pool.query(
        `SELECT * FROM product_uoms WHERE product_id = $1 ORDER BY conversion_factor ASC`,
        [matchedProductId],
      );
      prod.uoms = uoms;

      // Live stock in hub
      let hubStock = prod.stock;
      if (hubId) {
        const { rows: sRows } = await pool.query(
          'SELECT total_base_qty FROM hub_inventory_stocks WHERE hub_id = $1 AND product_id = $2',
          [hubId, matchedProductId],
        );
        if (sRows.length > 0) {
          hubStock = sRows[0].total_base_qty;
        }
      }
      prod.hub_stock = hubStock;

      const matchedUom = matchedUomRow
        ? uoms.find((u: any) => u.id === matchedUomRow.id)
        : (uoms.find((u: any) => u.is_default) || uoms[0] || null);

      res.json({
        product: prod,
        matchedUom,
        activePrice: matchedUom ? Number(matchedUom.retail_price) : Number(prod.price),
        activeUomName: matchedUom?.uom_name || prod.base_uom || 'Cái',
        hubStock,
      });
    }),
  );

  router.get(
    '/products/:id',
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const { rows } = await pool.query(
        `SELECT p.*,
                COALESCE(gc.name, p.category) AS category_name,
                gc.slug AS category_slug,
                gc.icon_name AS category_icon,
                gc.created_by AS category_created_by
           FROM products p
      LEFT JOIN grocery_categories gc ON gc.id = p.category_id
          WHERE p.id = $1`,
        [id],
      );
      if (!rows[0]) throw notFound('Product');
      const p = rows[0];

      const { rows: uoms } = await pool.query(
        `SELECT * FROM product_uoms WHERE product_id = $1 ORDER BY conversion_factor ASC`,
        [id],
      );
      p.uoms = uoms;

      if (p.is_combo) {
        const { rows: comboItems } = await pool.query(
          `SELECT ci.*, p2.name AS item_name, u.uom_name, u.retail_price
             FROM combo_items ci
             JOIN products p2 ON p2.id = ci.item_product_id
             JOIN product_uoms u ON u.id = ci.uom_id
            WHERE ci.combo_product_id = $1`,
          [id],
        );
        p.combo_items = comboItems;
      }

      res.json(p);
    }),
  );

  router.post(
    '/products',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(productSchema, req.body);
      let categoryId = b.categoryId ?? null;
      let categorySlug = b.category ?? 'general';

      if (categoryId) {
        const catRes = await pool.query('SELECT id, slug, name FROM grocery_categories WHERE id = $1', [categoryId]);
        if (!catRes.rows[0]) throw badRequest(`Danh mục (Category ID: ${categoryId}) không tồn tại`);
        categorySlug = catRes.rows[0].slug;
      } else if (b.category && b.category !== 'general') {
        const catRes = await pool.query('SELECT id, slug FROM grocery_categories WHERE slug = $1 LIMIT 1', [b.category]);
        if (catRes.rows[0]) {
          categoryId = catRes.rows[0].id;
          categorySlug = catRes.rows[0].slug;
        }
      }

      try {
        const { rows } = await pool.query(
          `INSERT INTO products (
             seller_id, sku, name, description, category, category_id,
             base_uom, price, currency, stock, is_combo, image_url, barcode, min_alert_threshold
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            currentUser(req).id,
            b.sku,
            b.name,
            b.description ?? null,
            categorySlug,
            categoryId,
            b.baseUom,
            b.price,
            b.currency,
            b.stock,
            b.isCombo,
            b.imageUrl ?? null,
            b.barcode ?? null,
            b.minAlertThreshold,
          ],
        );

        const prod = rows[0];
        // Automatically create base UOM
        await pool.query(
          `INSERT INTO product_uoms (product_id, uom_name, conversion_factor, retail_price, is_default)
           VALUES ($1, $2, 1, $3, TRUE)
           ON CONFLICT DO NOTHING`,
          [prod.id, b.baseUom, b.price],
        );

        res.status(201).json(prod);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('SKU_TAKEN', `SKU ${b.sku} already exists`);
        throw err;
      }
    }),
  );

  router.post(
    '/products/:id/uoms',
    seller,
    asyncHandler(async (req, res) => {
      const productId = validate(uuid, req.params.id);
      const b = validate(productUomSchema, req.body);
      const { rows } = await pool.query(
        `INSERT INTO product_uoms (product_id, uom_name, conversion_factor, retail_price, wholesale_price, barcode, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (product_id, uom_name) DO UPDATE SET
           conversion_factor = EXCLUDED.conversion_factor,
           retail_price = EXCLUDED.retail_price,
           wholesale_price = EXCLUDED.wholesale_price,
           barcode = EXCLUDED.barcode,
           is_default = EXCLUDED.is_default
         RETURNING *`,
        [productId, b.uomName, b.conversionFactor, b.retailPrice, b.wholesalePrice ?? null, b.barcode ?? null, b.isDefault],
      );
      res.status(201).json(rows[0]);
    }),
  );

  router.patch(
    '/products/:id',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const b = validate(productPatchSchema, req.body);
      const user = currentUser(req);
      const existing = await pool.query('SELECT seller_id FROM products WHERE id = $1', [id]);
      if (!existing.rows[0]) throw notFound('Product');
      if (user.role !== 'admin' && existing.rows[0].seller_id !== user.id) throw forbidden();

      let targetCategoryId = b.categoryId;
      let targetCategorySlug = b.category;
      if (targetCategoryId) {
        const catRes = await pool.query('SELECT id, slug FROM grocery_categories WHERE id = $1', [targetCategoryId]);
        if (!catRes.rows[0]) throw badRequest(`Danh mục (Category ID: ${targetCategoryId}) không tồn tại`);
        targetCategorySlug = catRes.rows[0].slug;
      }

      const { rows } = await pool.query(
        `UPDATE products SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           category = COALESCE($4, category),
           price = COALESCE($5, price),
           currency = COALESCE($6, currency),
           stock = COALESCE($7, stock),
           active = COALESCE($8, active),
           image_url = COALESCE($9, image_url),
           barcode = COALESCE($10, barcode),
           min_alert_threshold = COALESCE($11, min_alert_threshold),
           category_id = COALESCE($12, category_id)
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.name ?? null,
          b.description ?? null,
          targetCategorySlug ?? null,
          b.price ?? null,
          b.currency ?? null,
          b.stock ?? null,
          b.active ?? null,
          b.imageUrl ?? null,
          b.barcode ?? null,
          b.minAlertThreshold ?? null,
          targetCategoryId ?? null,
        ],
      );
      res.json(rows[0]);
    }),
  );

  // ---------- Zero-Friction Quick-Commerce Checkout (No OTP Required) ----------
  router.post(
    '/checkout',
    asyncHandler(async (req, res) => {
      const b = validate(checkoutSchema, req.body);
      const user = req.user;

      // 1. Validation with property-service if tenant debt charge or room delivery
      let tenantInfo: Awaited<ReturnType<typeof validateTenantWithPropertyService>> | null = null;
      if (b.customerType === 'RETAIL') {
        if (b.paymentMethod === 'DEBT_ADDED_TO_RENT') {
          throw badRequest('Khách vãng lai vui lòng chọn thanh toán qua VietQR hoặc Tiền mặt khi nhận hàng (COD).');
        }
      } else {
        // Tenant customer
        if (!b.propertyId) throw badRequest('Khách thuê vui lòng chọn tòa nhà / ký túc xá');
        if (!b.roomNumber) throw badRequest('Khách thuê vui lòng nhập số phòng');

        if (b.paymentMethod === 'DEBT_ADDED_TO_RENT' || b.deliveryType === 'ROOM_DELIVERY') {
          tenantInfo = await validateTenantWithPropertyService(b.propertyId, b.roomNumber, b.recipientPhone);
          if (!tenantInfo.isValid) {
            throw badRequest(
              tenantInfo.message ||
              `Số điện thoại ${b.recipientPhone} chưa khớp với người thuê hoặc người đăng ký tại phòng ${b.roomNumber}. Vui lòng chọn COD hoặc chuyển khoản VietQR.`,
            );
          }
        }
      }

      // 2. Resolve hub for this property
      let targetPropertyId: string = b.propertyId ?? '';
      if (!targetPropertyId) {
        const { rows: firstHub } = await pool.query('SELECT property_id FROM inventory_hubs WHERE is_active LIMIT 1');
        targetPropertyId = firstHub[0]?.property_id ?? '00000000-0000-0000-0000-000000000001';
      }
      const hubId = await getOrCreateHub(pool, targetPropertyId);

      // 3. Process inside transaction: compute prices, allocate FIFO stock, insert order
      const result = await transaction(pool, async (client) => {
        let orderTotal = 0;
        let currency = 'VND';
        const orderLineItems: Array<{
          productId: string;
          productName: string;
          uomId: string | null;
          uomName: string;
          unitPrice: number;
          quantity: number;
          baseQuantity: number;
          subtotal: number;
          batchAllocations: BatchAllocation[];
        }> = [];

        for (const item of b.items) {
          const { rows: prodRows } = await client.query('SELECT * FROM products WHERE id = $1', [item.productId]);
          const prod = prodRows[0];
          if (!prod) throw notFound(`Product ${item.productId}`);
          if (!prod.active) throw badRequest(`Sản phẩm "${prod.name}" hiện đang ngừng kinh doanh.`);
          currency = prod.currency;

          let unitPrice = Number(prod.price);
          let uomName = prod.base_uom;
          let conversionFactor = 1;

          if (item.uomId) {
            const { rows: uomRows } = await client.query('SELECT * FROM product_uoms WHERE id = $1', [item.uomId]);
            if (uomRows[0]) {
              unitPrice = Number(uomRows[0].retail_price);
              uomName = uomRows[0].uom_name;
              conversionFactor = Number(uomRows[0].conversion_factor);
            }
          }

          const baseQuantity = item.quantity * conversionFactor;
          const subtotal = Math.round(unitPrice * item.quantity * 100) / 100;
          orderTotal = Math.round((orderTotal + subtotal) * 100) / 100;

          // FIFO stock allocation from earliest expiration date
          const batchAllocations = await allocateStockFIFO(client, hubId, item.productId, baseQuantity);

          orderLineItems.push({
            productId: prod.id,
            productName: prod.name,
            uomId: item.uomId ?? null,
            uomName,
            unitPrice,
            quantity: item.quantity,
            baseQuantity,
            subtotal,
            batchAllocations,
          });

          // Check low-stock alert threshold
          const { rows: remRows } = await client.query(
            'SELECT COALESCE(SUM(remaining_qty), 0)::int AS total_rem FROM inventory_batches WHERE hub_id = $1 AND product_id = $2',
            [hubId, prod.id],
          );
          const totalRem = Number(remRows[0]?.total_rem);
          if (totalRem <= Number(prod.min_alert_threshold)) {
            // Record alert
            await client.query(
              `INSERT INTO hub_inventory_stocks (hub_id, product_id, total_base_qty, updated_at)
               VALUES ($1, $2, $3, now())
               ON CONFLICT (hub_id, product_id) DO UPDATE SET total_base_qty = EXCLUDED.total_base_qty, updated_at = now()`,
              [hubId, prod.id, totalRem],
            );
          }
        }

        // Check credit limit for tenant if DEBT_ADDED_TO_RENT
        if (b.paymentMethod === 'DEBT_ADDED_TO_RENT' && tenantInfo) {
          const deposit = tenantInfo.deposit || 0;
          const maxAllowedDebt = deposit > 0 ? deposit * 0.8 : 500000; // max 80% deposit or 500k default
          const { rows: debtRows } = await client.query(
            `SELECT COALESCE(SUM(total), 0)::numeric AS current_debt
               FROM orders
              WHERE tenant_id = $1 AND payment_method = 'DEBT_ADDED_TO_RENT' AND status = 'pending'`,
            [tenantInfo.tenantId],
          );
          const currentDebt = Number(debtRows[0]?.current_debt || 0);
          if (currentDebt + orderTotal > maxAllowedDebt) {
            throw badRequest(
              `Hạn mức nợ tiền tạp hóa vượt quá mức cho phép (${maxAllowedDebt.toLocaleString('vi-VN')} đ so với tiền cọc). Vui lòng chọn thanh toán VietQR hoặc COD.`,
            );
          }
        }

        // Generate human-friendly order number: ORD-YYYYMMDD-XXXX
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        const orderNumber = `ORD-${dateStr}-${randomSuffix}`;

        const customerId = user ? user.id : (tenantInfo?.tenantId || '00000000-0000-0000-0000-000000000000');

        const finalRoomOrAddress = b.customerType === 'RETAIL' ? (b.recipientAddress || 'Giao tận nơi') : (b.roomNumber || '—');

        const { rows: orderRows } = await client.query(
          `INSERT INTO orders (
             order_number, customer_id, property_id, hub_id, room_number,
             recipient_name, recipient_phone, delivery_type, payment_method,
             tenant_id, contract_id, total, currency, note, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending')
           RETURNING *`,
          [
            orderNumber,
            customerId,
            targetPropertyId,
            hubId,
            finalRoomOrAddress,
            b.recipientName,
            b.recipientPhone,
            b.deliveryType,
            b.paymentMethod,
            tenantInfo?.tenantId ?? null,
            tenantInfo?.contractId ?? null,
            orderTotal,
            currency,
            b.note ?? null,
          ],
        );

        const order = orderRows[0];

        // Insert order_items & batch allocations
        for (const it of orderLineItems) {
          const itemRes = await client.query(
            `INSERT INTO order_items (
               order_id, product_id, name, unit_price, quantity,
               uom_id, uom_name, total_base_qty
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [
              order.id,
              it.productId,
              it.productName,
              it.unitPrice,
              it.quantity,
              it.uomId,
              it.uomName,
              it.baseQuantity,
            ],
          );
          const orderItemId = itemRes.rows[0].id;
          for (const alloc of it.batchAllocations) {
            await client.query(
              `INSERT INTO order_item_batch_allocations (order_item_id, batch_id, quantity)
               VALUES ($1, $2, $3)`,
              [orderItemId, alloc.batchId, alloc.allocatedQty],
            );
          }
        }

        return { order, items: orderLineItems, tenantInfo };
      });

      const { order, items: orderLineItems, tenantInfo: tInfo } = result;
      const itemsSummary = orderLineItems.map((i) => `${i.quantity}x ${i.productName} (${i.uomName})`).join(', ');

      // Publish RabbitMQ events after transaction commits
      const groceryEvent: GroceryOrderCreatedData = {
        orderId: order.id,
        orderNumber: order.order_number,
        propertyId: order.property_id,
        hubId,
        roomNumber: order.room_number,
        customerName: b.recipientName,
        customerPhone: b.recipientPhone,
        totalAmount: Number(order.total),
        currency: order.currency,
        deliveryType: b.deliveryType,
        paymentMethod: b.paymentMethod,
        items: orderLineItems.map((i) => ({
          productName: i.productName,
          uomName: i.uomName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          subtotal: i.subtotal,
        })),
        note: b.note,
        createdAt: new Date().toISOString(),
      };
      await bus.publish(Events.GroceryOrderCreated, groceryEvent);

      // Publish OrderPlaced event to accounting-service for store invoice generation
      const checkoutOwnerId = tInfo?.landlordUserId || (user?.role === 'landlord' ? user.id : null);
      const orderPlacedEvent: OrderPlacedData = {
        orderId: order.id,
        orderNumber: order.order_number,
        customerId: order.customer_id,
        propertyId: order.property_id,
        hubId,
        ownerId: checkoutOwnerId,
        total: Number(order.total),
        currency: order.currency,
        items: orderLineItems.map((i) => ({
          productId: i.productId,
          name: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        paymentMethod: b.paymentMethod,
        isPaid: false,
        customerName: b.recipientName,
        roomNumber: b.roomNumber,
      };
      await bus.publish(Events.OrderPlaced, orderPlacedEvent);

      const alertData: NotificationLandlordAlertData = {
        eventType: 'NEW_ORDER_FOR_PROPERTY',
        propertyId: order.property_id,
        managerUserIds: tInfo?.landlordUserId ? [tInfo.landlordUserId] : [],
        orderId: order.id,
        orderNumber: order.order_number,
        roomNumber: order.room_number,
        customerName: b.recipientName,
        customerPhone: b.recipientPhone,
        itemsSummary,
        totalAmount: Number(order.total),
        deliveryType: b.deliveryType,
        paymentMethod: b.paymentMethod,
        zaloWebhookUrl: tInfo?.zaloWebhookUrl ?? null,
        zaloGroupId: tInfo?.zaloGroupId ?? null,
        telegramChatId: tInfo?.telegramChatId ?? null,
        note: b.note,
        createdAt: new Date().toISOString(),
      };
      await bus.publish(Events.NotificationLandlordAlert, alertData);

      // Asynchronously trigger Telegram / Zalo notifications
      void dispatchLandlordNotifications(pool, {
        orderId: order.id,
        orderNumber: order.order_number,
        propertyId: order.property_id,
        roomNumber: order.room_number,
        customerName: b.recipientName,
        customerPhone: b.recipientPhone,
        itemsSummary,
        totalAmount: Number(order.total),
        deliveryType: b.deliveryType,
        paymentMethod: b.paymentMethod,
        note: b.note,
        zaloWebhookUrl: tInfo?.zaloWebhookUrl,
        zaloGroupId: tInfo?.zaloGroupId,
        telegramChatId: tInfo?.telegramChatId,
      });

      // Broadcast realtime event to Angular landlord dashboards (triggers Ding-Dong sound chime)
      broadcastOrderEvent({
        id: order.id,
        orderNumber: order.order_number,
        propertyId: order.property_id,
        roomNumber: order.room_number,
        customerName: b.recipientName,
        customerPhone: b.recipientPhone,
        itemsSummary,
        totalAmount: Number(order.total),
        paymentMethod: b.paymentMethod,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        orderId: order.id,
        orderNumber: order.order_number,
        status: order.status,
        deliveryType: order.delivery_type,
        paymentMethod: order.payment_method,
        totalAmount: Number(order.total),
        currency: order.currency,
        roomNumber: order.room_number,
        estimatedDelivery: '15-30 phút',
        message: 'Đơn hàng đã được tiếp nhận! Quản lý tòa nhà đang soạn hàng mang lên phòng.',
      });
    }),
  );

  // ---------- POS Counter Checkout (Bán Hàng Quét Mã Vạch Tại Quầy) ----------
  router.post(
    '/pos/checkout',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(posCheckoutSchema, req.body);
      const cashier = currentUser(req);

      let targetHubId = b.hubId;
      if (!targetHubId) {
        const { rows: hRows } = await pool.query(
          'SELECT id FROM inventory_hubs WHERE is_active ORDER BY created_at ASC LIMIT 1',
        );
        targetHubId = hRows[0]?.id;
      }
      if (!targetHubId) throw badRequest('Chưa cấu hình kho hàng Hub để bán hàng.');

      const hubId = targetHubId;

      // Hub info
      const { rows: hubRows } = await pool.query('SELECT * FROM inventory_hubs WHERE id = $1', [hubId]);
      const hub = hubRows[0];
      const propertyId = hub?.property_id ?? '3958908e-d7e7-4ba3-848d-d44154ced104';

      let tenantId: string | null = null;
      let contractId: string | null = null;
      const customerId: string = cashier.id;

      if (b.customerType === 'TENANT') {
        if (!b.roomNumber?.trim()) {
          throw badRequest('Vui lòng nhập hoặc chọn số phòng của khách thuê.');
        }
        const verifyRes = await validateTenantWithPropertyService(
          propertyId,
          b.roomNumber.trim(),
          b.recipientPhone?.trim() || '',
        );
        if (!verifyRes.isValid) {
          throw badRequest(`Xác thực phòng không thành công: ${verifyRes.message || verifyRes.reason}`);
        }
        tenantId = verifyRes.tenantId ?? null;
        contractId = verifyRes.contractId ?? null;
      }

      const orderNumber = `POS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const orderResult = await transaction(pool, async (client) => {
        let orderTotal = 0;
        let currency = 'VND';
        const lineItems: Array<{
          productId: string;
          productName: string;
          uomId: string | null;
          uomName: string;
          unitPrice: number;
          quantity: number;
          baseQuantity: number;
          subtotal: number;
        }> = [];

        for (const item of b.items) {
          const { rows: pRows } = await client.query('SELECT * FROM products WHERE id = $1', [item.productId]);
          const prod = pRows[0];
          if (!prod) throw notFound(`Product ${item.productId}`);
          if (!prod.active) throw badRequest(`Sản phẩm "${prod.name}" hiện đang ngừng kinh doanh.`);
          currency = prod.currency;

          let unitPrice = Number(prod.price);
          let uomName = prod.base_uom;
          let conversionFactor = 1;

          if (item.uomId) {
            const { rows: uRows } = await client.query('SELECT * FROM product_uoms WHERE id = $1', [item.uomId]);
            if (uRows[0]) {
              unitPrice = Number(uRows[0].retail_price);
              uomName = uRows[0].uom_name;
              conversionFactor = Number(uRows[0].conversion_factor);
            }
          }

          const baseQuantity = item.quantity * conversionFactor;
          const subtotal = Math.round(unitPrice * item.quantity * 100) / 100;
          orderTotal = Math.round((orderTotal + subtotal) * 100) / 100;

          // Allocate stock via FIFO
          await allocateStockFIFO(client, hubId, item.productId, baseQuantity);

          lineItems.push({
            productId: prod.id,
            productName: prod.name,
            uomId: item.uomId ?? null,
            uomName,
            unitPrice,
            quantity: item.quantity,
            baseQuantity,
            subtotal,
          });

          // Sync stock count
          const { rows: remRows } = await client.query(
            'SELECT COALESCE(SUM(remaining_qty), 0)::int AS total_rem FROM inventory_batches WHERE hub_id = $1 AND product_id = $2',
            [hubId, prod.id],
          );
          const totalRem = Number(remRows[0]?.total_rem);
          await client.query(
            `INSERT INTO hub_inventory_stocks (hub_id, product_id, total_base_qty, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (hub_id, product_id) DO UPDATE SET total_base_qty = EXCLUDED.total_base_qty, updated_at = now()`,
            [hubId, prod.id, totalRem],
          );
          await client.query('UPDATE products SET stock = $2 WHERE id = $1', [prod.id, totalRem]);
        }

        const cashGiven = b.cashGiven ? Number(b.cashGiven) : null;
        const cashReturned =
          cashGiven && cashGiven >= orderTotal ? Math.round((cashGiven - orderTotal) * 100) / 100 : 0;
        const status = b.paymentMethod === 'DEBT_ADDED_TO_RENT' ? 'pending' : 'fulfilled';
        const isFulfilled = status === 'fulfilled';

        const orderIns = await client.query(
          `INSERT INTO orders (
             order_number, customer_id, status, total, currency, property_id, hub_id,
             room_number, recipient_name, recipient_phone, delivery_type, payment_method,
             tenant_id, contract_id, note, is_pos_counter, cash_given, cash_returned,
             delivered_at, delivered_by, created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'COUNTER_PICKUP', $11, $12, $13, $14, TRUE, $15, $16, ${isFulfilled ? 'now()' : 'NULL'}, $17, now(), now())
           RETURNING *`,
          [
            orderNumber,
            customerId,
            status,
            orderTotal,
            currency,
            propertyId,
            hubId,
            b.roomNumber ?? 'Tại quầy',
            b.recipientName ??
            (b.customerType === 'TENANT' ? `Khách phòng ${b.roomNumber}` : 'Khách mua tại quầy'),
            b.recipientPhone ?? null,
            b.paymentMethod,
            tenantId,
            contractId,
            b.note ?? 'Bán hàng trực tiếp tại quầy POS',
            cashGiven,
            cashReturned,
            cashier.id,
          ],
        );
        const order = orderIns.rows[0];

        // Insert line items
        for (const li of lineItems) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, uom_id, uom_name, total_base_qty)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              order.id,
              li.productId,
              li.productName,
              li.unitPrice,
              li.quantity,
              li.uomId,
              li.uomName,
              li.baseQuantity,
            ],
          );
        }

        return { order, lineItems, cashGiven, cashReturned };
      });

      // Publish OrderPlaced to accounting-service for invoice & payment recording
      const posOwnerId = hub?.manager_user_id || cashier.id;
      const isPosPaid = b.paymentMethod === 'CASH' || b.paymentMethod === 'VIETQR';
      await bus.publish<OrderPlacedData>(Events.OrderPlaced, {
        orderId: orderResult.order.id,
        orderNumber: orderResult.order.order_number,
        customerId: orderResult.order.customer_id,
        propertyId: orderResult.order.property_id,
        hubId: orderResult.order.hub_id,
        ownerId: posOwnerId,
        total: Number(orderResult.order.total),
        currency: orderResult.order.currency,
        items: orderResult.lineItems.map((i) => ({
          productId: i.productId,
          name: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
        paymentMethod: b.paymentMethod,
        isPaid: isPosPaid,
        paidMethod: b.paymentMethod === 'VIETQR' ? 'bank_transfer' : 'cash',
        recordedBy: cashier.id,
        customerName: orderResult.order.recipient_name,
        roomNumber: b.roomNumber,
      });

      // If debt added to rent, trigger event to accounting-service
      if (b.paymentMethod === 'DEBT_ADDED_TO_RENT' && tenantId && contractId) {
        const currentPeriod = new Date().toISOString().slice(0, 7);
        await bus.publish<TenantDebtChargeRequestedData>(Events.TenantDebtChargeRequested, {
          orderId: orderResult.order.id,
          orderNumber: orderResult.order.order_number,
          tenantId,
          contractId,
          propertyId,
          amount: Number(orderResult.order.total),
          currency: orderResult.order.currency,
          description: `Tạp hóa tại quầy POS - Đơn #${orderResult.order.order_number} (Phòng ${b.roomNumber})`,
          period: currentPeriod,
          requestedAt: new Date().toISOString(),
        });
      }

      // Broadcast realtime event to Angular landlord dashboards (triggers Ding-Dong sound chime & toast)
      broadcastOrderEvent({
        id: orderResult.order.id,
        orderNumber: orderResult.order.order_number,
        propertyId: orderResult.order.property_id,
        roomNumber: orderResult.order.room_number,
        customerName:
          b.recipientName ??
          (b.customerType === 'TENANT' ? `Khách phòng ${b.roomNumber}` : 'Khách mua tại quầy'),
        customerPhone: b.recipientPhone,
        itemsSummary: orderResult.lineItems.map((i) => `${i.quantity}x ${i.productName} (${i.uomName})`).join(', '),
        totalAmount: Number(orderResult.order.total),
        paymentMethod: b.paymentMethod,
        customerType: b.customerType,
        isPosCounter: true,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({
        success: true,
        order: orderResult.order,
        items: orderResult.lineItems,
        receipt: {
          storeName: hub?.name || 'RentalHub Convenience Store',
          storeAddress: hub?.address || 'Tại sảnh tòa nhà',
          orderNumber: orderResult.order.order_number,
          cashierName: cashier.email,
          createdAt: new Date().toISOString(),
          customerType: b.customerType,
          roomNumber: b.roomNumber,
          customerName: orderResult.order.recipient_name,
          paymentMethod: b.paymentMethod,
          total: Number(orderResult.order.total),
          cashGiven: orderResult.cashGiven,
          cashReturned: orderResult.cashReturned,
          currency: orderResult.order.currency,
        },
      });
    }),
  );

  // ---------- Handover Confirmation & Debt Invoicing ----------
  router.post(
    '/orders/:id/deliver',
    seller,
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = currentUser(req);

      const order = await transaction(pool, async (db) => {
        const { rows } = await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]);
        const o = rows[0];
        if (!o) throw notFound('Order');
        if (o.status === 'fulfilled' || o.status === 'cancelled') {
          throw conflict('ORDER_CLOSED', `Đơn hàng đã ở trạng thái ${o.status}`);
        }

        const updated = await db.query(
          `UPDATE orders SET
             status = 'fulfilled',
             delivered_at = now(),
             delivered_by = $2,
             updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, user.id],
        );
        return updated.rows[0];
      });

      // If payment was DEBT_ADDED_TO_RENT, trigger accounting-service to add to monthly rent invoice
      if (order.payment_method === 'DEBT_ADDED_TO_RENT' && order.contract_id && order.tenant_id) {
        const currentPeriod = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
        await bus.publish<TenantDebtChargeRequestedData>(Events.TenantDebtChargeRequested, {
          orderId: order.id,
          orderNumber: order.order_number || order.id.slice(0, 8),
          tenantId: order.tenant_id,
          contractId: order.contract_id,
          propertyId: order.property_id,
          amount: Number(order.total),
          currency: order.currency,
          description: `Tiền tạp hóa nội khu - Đơn #${order.order_number || order.id.slice(0, 8)} (${order.room_number || 'Phòng'})`,
          period: currentPeriod,
          requestedAt: new Date().toISOString(),
        });
      }

      // If payment was COD or VIETQR, notify accounting-service that order is now paid
      if (order.payment_method === 'COD' || order.payment_method === 'VIETQR') {
        await bus.publish<OrderPaidData>(Events.OrderPaid, {
          orderId: order.id,
          orderNumber: order.order_number,
          customerId: order.customer_id,
          propertyId: order.property_id,
          amount: Number(order.total),
          currency: order.currency,
          paymentMethod: order.payment_method,
          paidMethod: order.payment_method === 'VIETQR' ? 'bank_transfer' : 'cash',
          recordedBy: user.id,
          paidAt: new Date().toISOString(),
        });
      }

      res.json({
        success: true,
        order,
        message: 'Đã xác nhận bàn giao hàng thành công!',
      });
    }),
  );

  // ---------- Inventory Batch Import (FIFO) ----------
  router.post(
    '/inventory/import-batch',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(importBatchSchema, req.body);
      const batch = await transaction(pool, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO inventory_batches (
             hub_id, product_id, batch_number, mfg_date, exp_date, cost_price, initial_qty, remaining_qty
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            b.hubId,
            b.productId,
            b.batchNumber,
            b.mfgDate ?? null,
            b.expDate,
            b.costPrice,
            b.quantity,
            b.quantity,
          ],
        );

        // Update hub stock total
        await db.query(
          `INSERT INTO hub_inventory_stocks (hub_id, product_id, total_base_qty, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (hub_id, product_id) DO UPDATE SET
             total_base_qty = hub_inventory_stocks.total_base_qty + EXCLUDED.total_base_qty,
             updated_at = now()`,
          [b.hubId, b.productId, b.quantity],
        );

        // Update product master stock count
        await db.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [b.productId, b.quantity]);

        return rows[0];
      });

      res.status(201).json(batch);
    }),
  );

  // ---------- Barcode Inbound Stocking (Nhập kho bằng máy quét mã vạch) ----------
  router.post(
    '/inventory/barcode-import',
    seller,
    asyncHandler(async (req, res) => {
      const b = validate(barcodeImportSchema, req.body);
      const code = b.barcode.trim();

      // Look up product or uom by barcode
      let targetProductId: string | null = null;
      let matchedUom: any = null;

      const uomMatch = await pool.query(
        `SELECT u.*, p.id as p_id, p.name as p_name, p.sku as p_sku, p.base_uom as p_base_uom
           FROM product_uoms u
           JOIN products p ON p.id = u.product_id
          WHERE u.barcode = $1
          LIMIT 1`,
        [code],
      );

      if (uomMatch.rows.length > 0) {
        matchedUom = uomMatch.rows[0];
        targetProductId = matchedUom.p_id;
      } else {
        const prodMatch = await pool.query(
          `SELECT id, name, sku, base_uom FROM products WHERE (barcode = $1 OR sku ILIKE $1) LIMIT 1`,
          [code],
        );
        if (prodMatch.rows.length > 0) {
          targetProductId = prodMatch.rows[0].id;
        }
      }

      if (!targetProductId) {
        throw notFound(
          `Không tìm thấy sản phẩm khớp mã vạch: "${code}". Vui lòng đăng ký mã vạch trong quản lý sản phẩm trước.`,
        );
      }

      const conversionFactor = matchedUom ? Number(matchedUom.conversion_factor) : 1;
      const totalBaseQty = b.quantity * conversionFactor;
      const batchNumber =
        b.batchNumber?.trim() ||
        `LOT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const result = await transaction(pool, async (client) => {
        const batchIns = await client.query(
          `INSERT INTO inventory_batches (
             hub_id, product_id, batch_number, mfg_date, exp_date, cost_price, initial_qty, remaining_qty
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            b.hubId,
            targetProductId,
            batchNumber,
            b.mfgDate ?? null,
            b.expDate,
            b.costPrice,
            totalBaseQty,
            totalBaseQty,
          ],
        );

        // Update hub stock
        const hubStockRes = await client.query(
          `INSERT INTO hub_inventory_stocks (hub_id, product_id, total_base_qty, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (hub_id, product_id) DO UPDATE SET
             total_base_qty = hub_inventory_stocks.total_base_qty + EXCLUDED.total_base_qty,
             updated_at = now()
           RETURNING total_base_qty`,
          [b.hubId, targetProductId, totalBaseQty],
        );

        // Update master product stock
        await client.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [
          targetProductId,
          totalBaseQty,
        ]);

        const prodRes = await client.query('SELECT * FROM products WHERE id = $1', [targetProductId]);

        return {
          batch: batchIns.rows[0],
          product: prodRes.rows[0],
          hubStock: hubStockRes.rows[0]?.total_base_qty,
        };
      });

      res.status(201).json({
        success: true,
        message: `Đã nhập kho thành công ${b.quantity} ${matchedUom ? matchedUom.uom_name : result.product.base_uom} (= ${totalBaseQty} ${result.product.base_uom}) vào lô ${batchNumber}`,
        product: result.product,
        matchedUom,
        batch: result.batch,
        quantityScanned: b.quantity,
        totalBaseQtyAdded: totalBaseQty,
        newHubStock: result.hubStock,
      });
    }),
  );

  router.get(
    '/inventory/batches',
    seller,
    asyncHandler(async (req, res) => {
      const hubId = req.query.hubId as string | undefined;
      const params: unknown[] = [];
      let where = 'WHERE b.remaining_qty > 0';
      if (hubId) {
        params.push(hubId);
        where += ` AND b.hub_id = $${params.length}`;
      }

      const { rows } = await pool.query(
        `SELECT b.*,
                p.name AS product_name,
                p.base_uom,
                h.name AS hub_name,
                (b.exp_date <= CURRENT_DATE + INTERVAL '30 day') AS is_near_expiry,
                (b.exp_date < CURRENT_DATE) AS is_expired
           FROM inventory_batches b
           JOIN products p ON p.id = b.product_id
           JOIN inventory_hubs h ON h.id = b.hub_id
          ${where}
          ORDER BY b.exp_date ASC`,
        params,
      );
      res.json({ items: rows });
    }),
  );

  // ---------- Landlord Notifications List ----------
  router.get(
    '/notifications',
    seller,
    asyncHandler(async (req, res) => {
      const propertyId = req.query.propertyId as string | undefined;
      const params: unknown[] = [];
      let where = '';
      if (propertyId) {
        params.push(propertyId);
        where = `WHERE property_id = $1`;
      }
      const { rows } = await pool.query(
        `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 50`,
        params,
      );
      res.json({ items: rows });
    }),
  );

  // ---------- Realtime SSE Orders Stream for Landlord Dashboard Audio Alerts ----------
  router.get('/events/orders-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`: connected\n\n`);
    sseClients.add(res);

    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // ---------- Standard Orders ----------
  router.get(
    '/orders',
    asyncHandler(async (req, res) => {
      const user = currentUser(req);
      const { page, limit, offset } = parsePagination(req.query);

      const params: unknown[] = [];
      const where: string[] = [];

      if (!canManageOrders(user)) {
        where.push(`customer_id = $${params.push(user.id)}`);
      }
      if (req.query.status && req.query.status !== 'all') {
        where.push(`status = $${params.push(req.query.status)}`);
      }
      if (req.query.propertyId) {
        where.push(`property_id = $${params.push(req.query.propertyId)}`);
      }

      const orderQ = (req.query.q || req.query.search) as string | undefined;
      if (orderQ?.trim()) {
        const idx = params.push(`%${orderQ.trim()}%`);
        where.push(`(id::text ILIKE $${idx} OR order_number ILIKE $${idx} OR note ILIKE $${idx} OR room_number ILIKE $${idx} OR recipient_name ILIKE $${idx})`);
      }

      if (req.query.startDate) {
        const sIdx = params.push(req.query.startDate);
        where.push(`created_at >= $${sIdx}::date`);
      }
      if (req.query.endDate) {
        const eIdx = params.push(req.query.endDate);
        where.push(`created_at < ($${eIdx}::date + interval '1 day')`);
      }

      const source = req.query.source as string | undefined;
      if (source === 'POS') {
        where.push(`is_pos_counter = TRUE`);
      } else if (source === 'ONLINE') {
        where.push(`(is_pos_counter = FALSE OR is_pos_counter IS NULL)`);
      } else if (source === 'TENANT') {
        where.push(`(room_number IS NOT NULL AND room_number != 'Tại quầy')`);
      }

      const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM orders ${whereClause}`, params);
      const total = countRes.rows[0]?.total ?? 0;

      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const { rows } = await pool.query(
        `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );
      res.json(paginatedResponse(rows, total, page, limit));
    }),
  );

  // ---------- Revenue Analytics for Landlords & Managers ----------
  router.get(
    '/orders/revenue-stats',
    seller,
    asyncHandler(async (req, res) => {
      const propertyId = req.query.propertyId as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;
      const source = req.query.source as string | undefined;

      // 1. Overall Today, Month, Year (Not cancelled)
      const baseParams: unknown[] = [];
      let baseWhere = "status != 'cancelled'";
      if (propertyId) {
        baseParams.push(propertyId);
        baseWhere += ` AND property_id = $${baseParams.length}`;
      }

      const todayRes = await pool.query(
        `SELECT COALESCE(SUM(total), 0)::numeric(14,2) AS today_revenue, COUNT(*)::int AS today_orders
           FROM orders WHERE ${baseWhere} AND created_at >= CURRENT_DATE`,
        baseParams,
      );

      const monthRes = await pool.query(
        `SELECT COALESCE(SUM(total), 0)::numeric(14,2) AS month_revenue, COUNT(*)::int AS month_orders
           FROM orders WHERE ${baseWhere} AND created_at >= date_trunc('month', CURRENT_DATE)`,
        baseParams,
      );

      const yearRes = await pool.query(
        `SELECT COALESCE(SUM(total), 0)::numeric(14,2) AS year_revenue, COUNT(*)::int AS year_orders
           FROM orders WHERE ${baseWhere} AND created_at >= date_trunc('year', CURRENT_DATE)`,
        baseParams,
      );

      // 2. Custom Period Stats
      const filterParams: unknown[] = [];
      const filterWhere: string[] = ["status != 'cancelled'"];
      if (propertyId) {
        filterWhere.push(`property_id = $${filterParams.push(propertyId)}`);
      }
      if (startDate) {
        filterWhere.push(`created_at >= $${filterParams.push(startDate)}::date`);
      }
      if (endDate) {
        filterWhere.push(`created_at < ($${filterParams.push(endDate)}::date + interval '1 day')`);
      }
      if (source === 'POS') {
        filterWhere.push(`is_pos_counter = TRUE`);
      } else if (source === 'ONLINE') {
        filterWhere.push(`(is_pos_counter = FALSE OR is_pos_counter IS NULL)`);
      } else if (source === 'TENANT') {
        filterWhere.push(`(room_number IS NOT NULL AND room_number != 'Tại quầy')`);
      }

      const filterClause = `WHERE ${filterWhere.join(' AND ')}`;

      const periodRes = await pool.query(
        `SELECT COALESCE(SUM(total), 0)::numeric(14,2) AS period_revenue, COUNT(*)::int AS period_orders
           FROM orders ${filterClause}`,
        filterParams,
      );

      const paymentRes = await pool.query(
        `SELECT payment_method,
                COALESCE(SUM(total), 0)::numeric(14,2) AS total,
                COUNT(*)::int AS count
           FROM orders ${filterClause}
          GROUP BY payment_method`,
        filterParams,
      );

      const dailyRes = await pool.query(
        `SELECT to_char(created_at, 'YYYY-MM-DD') AS date,
                COALESCE(SUM(total), 0)::numeric(14,2) AS revenue,
                COUNT(*)::int AS order_count
           FROM orders ${filterClause}
          GROUP BY to_char(created_at, 'YYYY-MM-DD')
          ORDER BY date ASC`,
        filterParams,
      );

      const pendingRes = await pool.query(
        `SELECT COUNT(*)::int AS pending_count FROM orders WHERE status = 'pending' ${propertyId ? 'AND property_id = $1' : ''}`,
        propertyId ? [propertyId] : [],
      );

      const paymentBreakdown: Record<string, { total: number; count: number }> = {};
      for (const r of paymentRes.rows) {
        paymentBreakdown[r.payment_method] = {
          total: Number(r.total),
          count: Number(r.count),
        };
      }

      res.json({
        todayRevenue: Number(todayRes.rows[0]?.today_revenue || 0),
        todayOrders: Number(todayRes.rows[0]?.today_orders || 0),
        monthRevenue: Number(monthRes.rows[0]?.month_revenue || 0),
        monthOrders: Number(monthRes.rows[0]?.month_orders || 0),
        yearRevenue: Number(yearRes.rows[0]?.year_revenue || 0),
        yearOrders: Number(yearRes.rows[0]?.year_orders || 0),
        periodRevenue: Number(periodRes.rows[0]?.period_revenue || 0),
        periodOrders: Number(periodRes.rows[0]?.period_orders || 0),
        pendingOrders: Number(pendingRes.rows[0]?.pending_count || 0),
        paymentBreakdown,
        dailyBreakdown: dailyRes.rows.map((r) => ({
          date: r.date,
          revenue: Number(r.revenue),
          orderCount: Number(r.order_count),
        })),
      });
    }),
  );

  // ---------- Guest Orders Lookup by Phone ----------
  router.get(
    '/guest/orders',
    asyncHandler(async (req, res) => {
      const phone = (req.query.phone as string | undefined)?.trim();
      if (!phone || phone.length < 8) {
        throw badRequest('Vui lòng cung cấp số điện thoại (tối thiểu 8 chữ số) để tra cứu đơn hàng');
      }
      const { rows } = await pool.query(
        `SELECT o.*,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'id', oi.id,
                    'name', oi.name,
                    'unit_price', oi.unit_price,
                    'quantity', oi.quantity,
                    'uom_name', oi.uom_name
                  )) FROM order_items oi WHERE oi.order_id = o.id
                ), '[]'::json) AS items
           FROM orders o
          WHERE o.recipient_phone = $1
          ORDER BY o.created_at DESC LIMIT 30`,
        [phone],
      );
      res.json({ items: rows });
    }),
  );

  router.get(
    '/orders/:id',
    asyncHandler(async (req, res) => {
      const id = validate(uuid, req.params.id);
      const user = req.user;
      const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
      const o = rows[0];
      if (!o) throw notFound('Order');
      if (user && !canManageOrders(user) && o.customer_id !== user.id) throw forbidden();
      const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
      res.json({ ...o, items: items.rows });
    }),
  );

  router.post(
    '/orders',
    asyncHandler(async (req, res) => {
      const b = validate(orderSchema, req.body);
      const user = currentUser(req);

      const { order, event } = await transaction(pool, async (db) => {
        let total = 0;
        let currency: string | null = null;
        const lines: Array<{ productId: string; name: string; unitPrice: number; quantity: number }> = [];

        for (const item of b.items) {
          const { rows } = await db.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
          const p = rows[0];
          if (!p) throw notFound(`Product ${item.productId}`);
          if (!p.active) throw badRequest(`Product ${p.name} is not available`);
          if (p.stock < item.quantity) {
            throw conflict('INSUFFICIENT_STOCK', `Only ${p.stock} units of ${p.name} left in stock`);
          }
          if (currency && p.currency !== currency) {
            throw badRequest('Mixed currencies in one order are not supported');
          }
          currency = p.currency;
          const lineTotal = Math.round(Number(p.price) * item.quantity * 100) / 100;
          total = Math.round((total + lineTotal) * 100) / 100;
          lines.push({ productId: p.id, name: p.name, unitPrice: Number(p.price), quantity: item.quantity });
        }

        const orderRes = await db.query(
          `INSERT INTO orders (customer_id, total, currency, note, status)
           VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
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
