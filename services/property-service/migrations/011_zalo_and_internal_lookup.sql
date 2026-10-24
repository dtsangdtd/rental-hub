-- Migration: Add Zalo & Telegram alert configurations for Landlord and index for fast tenant validation lookup
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS zalo_webhook_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS zalo_group_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS notify_on_new_order BOOLEAN NOT NULL DEFAULT TRUE;

-- Fast index for zero-friction tenant checkout lookup
CREATE INDEX IF NOT EXISTS idx_leases_unit_active ON leases(unit_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_occupants_unit_phone ON unit_occupants(unit_id, phone);
CREATE INDEX IF NOT EXISTS idx_tenants_phone_lookup ON tenants(phone);
