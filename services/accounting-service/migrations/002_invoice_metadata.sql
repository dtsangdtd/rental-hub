-- Add metadata column to invoices for storing bill breakdown items and utility details
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS metadata JSONB;
