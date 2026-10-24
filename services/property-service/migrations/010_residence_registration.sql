-- Migration 010: Residence Registration & Temporary Absence Management
-- Adds temporary residence / absence tracking to unit_occupants and tenants

ALTER TABLE unit_occupants
  ADD COLUMN IF NOT EXISTS temp_reg_status VARCHAR(30) NOT NULL DEFAULT 'not_registered',
  ADD COLUMN IF NOT EXISTS temp_reg_start_date DATE,
  ADD COLUMN IF NOT EXISTS temp_reg_end_date DATE,
  ADD COLUMN IF NOT EXISTS temp_reg_code TEXT,
  ADD COLUMN IF NOT EXISTS temp_reg_notes TEXT,
  ADD COLUMN IF NOT EXISTS temp_absence_reason TEXT,
  ADD COLUMN IF NOT EXISTS temp_absence_destination TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS temp_reg_status VARCHAR(30) NOT NULL DEFAULT 'not_registered',
  ADD COLUMN IF NOT EXISTS temp_reg_start_date DATE,
  ADD COLUMN IF NOT EXISTS temp_reg_end_date DATE,
  ADD COLUMN IF NOT EXISTS temp_reg_code TEXT,
  ADD COLUMN IF NOT EXISTS temp_reg_notes TEXT,
  ADD COLUMN IF NOT EXISTS temp_absence_reason TEXT,
  ADD COLUMN IF NOT EXISTS temp_absence_destination TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_unit_occupants_temp_reg_status ON unit_occupants(temp_reg_status);
CREATE INDEX IF NOT EXISTS idx_unit_occupants_temp_reg_end ON unit_occupants(temp_reg_end_date);
CREATE INDEX IF NOT EXISTS idx_tenants_temp_reg_status ON tenants(temp_reg_status);
