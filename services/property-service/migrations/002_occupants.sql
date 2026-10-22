CREATE TABLE unit_occupants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  id_number     TEXT,           -- CCCD / CMND
  birth_date    DATE,
  gender        TEXT,           -- Nam / Nữ / Khác
  relationship  TEXT DEFAULT 'Người ở cùng', -- Đại diện hợp đồng, Ở ghép, Vợ/Chồng, Con, Bạn bè...
  vehicle_plate TEXT,           -- Biển số xe máy
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_unit_occupants_unit ON unit_occupants(unit_id);
