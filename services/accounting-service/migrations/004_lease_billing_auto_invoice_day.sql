-- Add auto_invoice_day column to lease_billing
ALTER TABLE lease_billing ADD COLUMN IF NOT EXISTS auto_invoice_day SMALLINT NOT NULL DEFAULT 5;
