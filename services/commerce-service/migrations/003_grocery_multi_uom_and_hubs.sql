-- 1. Inventory Hubs / Building Mini-Hubs
CREATE TABLE IF NOT EXISTS inventory_hubs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL,
  name            VARCHAR(255) NOT NULL,
  address         TEXT NOT NULL,
  manager_user_id UUID,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hubs_property ON inventory_hubs(property_id);

-- 2. Grocery FMCG Categories
CREATE TABLE IF NOT EXISTS grocery_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        VARCHAR(100) UNIQUE NOT NULL,
  name        VARCHAR(255) NOT NULL,
  icon_name   VARCHAR(50) DEFAULT 'package',
  sort_order  INTEGER DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- 3. Extend products for grocery specifics
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES grocery_categories(id),
  ADD COLUMN IF NOT EXISTS base_uom VARCHAR(50) NOT NULL DEFAULT 'Cái',
  ADD COLUMN IF NOT EXISTS is_combo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(100),
  ADD COLUMN IF NOT EXISTS min_alert_threshold INTEGER DEFAULT 10;

-- 4. Multi-UOM (Unit of Measure)
CREATE TABLE IF NOT EXISTS product_uoms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  uom_name          VARCHAR(50) NOT NULL,
  conversion_factor INTEGER NOT NULL CHECK (conversion_factor >= 1),
  barcode           VARCHAR(100),
  retail_price      NUMERIC(14,2) NOT NULL CHECK (retail_price >= 0),
  wholesale_price   NUMERIC(14,2) CHECK (wholesale_price >= 0),
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, uom_name)
);
CREATE INDEX IF NOT EXISTS idx_uoms_product ON product_uoms(product_id);

-- 5. Combo items
CREATE TABLE IF NOT EXISTS combo_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  item_product_id   UUID NOT NULL REFERENCES products(id),
  uom_id            UUID NOT NULL REFERENCES product_uoms(id),
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)
);

-- 6. Batches with expiration date for FIFO inventory
CREATE TABLE IF NOT EXISTS inventory_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id            UUID NOT NULL REFERENCES inventory_hubs(id),
  product_id        UUID NOT NULL REFERENCES products(id),
  batch_number      VARCHAR(100) NOT NULL,
  mfg_date          DATE,
  exp_date          DATE NOT NULL,
  cost_price        NUMERIC(14,2) NOT NULL DEFAULT 0,
  initial_qty       INTEGER NOT NULL CHECK (initial_qty >= 0),
  remaining_qty     INTEGER NOT NULL CHECK (remaining_qty >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_batches_fifo ON inventory_batches(hub_id, product_id, exp_date ASC) WHERE remaining_qty > 0;

-- 7. Hub inventory stock cache
CREATE TABLE IF NOT EXISTS hub_inventory_stocks (
  hub_id            UUID NOT NULL REFERENCES inventory_hubs(id),
  product_id        UUID NOT NULL REFERENCES products(id),
  total_base_qty    INTEGER NOT NULL DEFAULT 0 CHECK (total_base_qty >= 0),
  reserved_qty      INTEGER NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, product_id)
);

-- 8. Extend orders for zero-friction grocery delivery
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS property_id UUID,
  ADD COLUMN IF NOT EXISTS hub_id UUID REFERENCES inventory_hubs(id),
  ADD COLUMN IF NOT EXISTS room_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(50) DEFAULT 'ROOM_DELIVERY',
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'DEBT_ADDED_TO_RENT',
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS contract_id UUID,
  ADD COLUMN IF NOT EXISTS debt_invoice_id UUID,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by UUID;

-- 9. Extend order items
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS uom_id UUID REFERENCES product_uoms(id),
  ADD COLUMN IF NOT EXISTS uom_name VARCHAR(50),
  ADD COLUMN IF NOT EXISTS conversion_factor INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_base_qty INTEGER;

-- FIFO allocation mapping
CREATE TABLE IF NOT EXISTS order_item_batch_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id   UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  batch_id        UUID NOT NULL REFERENCES inventory_batches(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0)
);

-- 10. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,
  property_id     UUID,
  type            VARCHAR(100) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  body            TEXT NOT NULL,
  metadata_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  sent_telegram   BOOLEAN NOT NULL DEFAULT FALSE,
  sent_zalo       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_property ON notifications(property_id, created_at DESC);
