CREATE TABLE properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL,             -- auth user id (landlord)
  name        TEXT NOT NULL,
  address     TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_properties_owner ON properties(owner_id);

CREATE TABLE units (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,            -- e.g. "Room 101"
  area_m2      NUMERIC(8,2),
  base_rent    NUMERIC(14,2) NOT NULL CHECK (base_rent >= 0),
  status       TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied', 'maintenance')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL,             -- landlord who manages this tenant record
  user_id     UUID,                      -- optional link to an auth user (tenant portal)
  full_name   TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  id_number   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenants_owner ON tenants(owner_id);

CREATE TABLE leases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL,
  unit_id       UUID NOT NULL REFERENCES units(id),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  start_date    DATE NOT NULL,
  end_date      DATE,
  monthly_rent  NUMERIC(14,2) NOT NULL CHECK (monthly_rent >= 0),
  deposit       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  currency      TEXT NOT NULL DEFAULT 'VND',
  due_day       SMALLINT NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 28),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  terminated_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Only one active lease per unit
CREATE UNIQUE INDEX uq_active_lease_per_unit ON leases(unit_id) WHERE status = 'active';
