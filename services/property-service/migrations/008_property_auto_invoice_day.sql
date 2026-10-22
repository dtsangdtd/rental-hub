-- Add auto_invoice_day column to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auto_invoice_day INT NOT NULL DEFAULT 5;
