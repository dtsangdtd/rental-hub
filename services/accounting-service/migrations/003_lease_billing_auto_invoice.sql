-- Add property_id and auto_invoice to lease_billing read model
ALTER TABLE lease_billing ADD COLUMN IF NOT EXISTS property_id UUID;
ALTER TABLE lease_billing ADD COLUMN IF NOT EXISTS auto_invoice BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lease_billing_auto_invoice ON lease_billing(active, auto_invoice) WHERE active = TRUE AND auto_invoice = TRUE;
