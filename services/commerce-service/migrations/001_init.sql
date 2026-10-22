CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   UUID NOT NULL,             -- admin or landlord
  sku         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'general', -- furniture, appliance, service, utility...
  price       NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  currency    TEXT NOT NULL DEFAULT 'VND',
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'fulfilled')),
  total        NUMERIC(14,2) NOT NULL,
  currency     TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE TABLE order_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  name        TEXT NOT NULL,             -- snapshot at purchase time
  unit_price  NUMERIC(14,2) NOT NULL,    -- snapshot at purchase time
  quantity    INTEGER NOT NULL CHECK (quantity > 0)
);
