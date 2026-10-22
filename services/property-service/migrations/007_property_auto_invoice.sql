-- Add auto_invoice column to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auto_invoice BOOLEAN NOT NULL DEFAULT FALSE;
