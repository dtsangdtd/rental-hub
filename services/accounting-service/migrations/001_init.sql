-- Idempotency for consumed events (see common/db.ts handleOnce)
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Local read-model of leases, built from property.lease.* events
CREATE TABLE lease_billing (
  lease_id        UUID PRIMARY KEY,
  owner_id        UUID NOT NULL,
  tenant_id       UUID NOT NULL,
  tenant_user_id  UUID,
  monthly_rent    NUMERIC(14,2) NOT NULL,
  currency        TEXT NOT NULL,
  due_day         SMALLINT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE,
  active          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number          TEXT NOT NULL UNIQUE,
  owner_id        UUID,                  -- landlord receiving money; NULL = platform (e-commerce)
  customer_id     UUID,                  -- auth user who pays (if known)
  reference_type  TEXT NOT NULL CHECK (reference_type IN ('lease', 'order', 'manual')),
  reference_id    UUID,
  kind            TEXT NOT NULL CHECK (kind IN ('rent', 'deposit', 'order', 'other')),
  period          TEXT,                  -- 'YYYY-MM' for rent invoices
  description     TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  amount_paid     NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partial', 'paid', 'void')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_owner ON invoices(owner_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
-- One rent invoice per lease per month
CREATE UNIQUE INDEX uq_rent_period ON invoices(reference_id, period) WHERE kind = 'rent';

CREATE SEQUENCE invoice_number_seq;

CREATE TABLE payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID NOT NULL REFERENCES invoices(id),
  amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method      TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'card', 'ewallet')),
  note        TEXT,
  recorded_by UUID NOT NULL,
  paid_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

CREATE TABLE expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL,
  property_id  UUID,
  category     TEXT NOT NULL CHECK (category IN ('maintenance', 'utilities', 'tax', 'insurance', 'salary', 'other')),
  description  TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency     TEXT NOT NULL DEFAULT 'VND',
  spent_on     DATE NOT NULL,
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_owner ON expenses(owner_id, spent_on);
