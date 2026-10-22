-- Add extended personal and address information to tenants
ALTER TABLE tenants
  ADD COLUMN street_address TEXT,
  ADD COLUMN ward TEXT,
  ADD COLUMN district TEXT,
  ADD COLUMN city TEXT,
  ADD COLUMN id_issue_date DATE,
  ADD COLUMN gender TEXT,
  ADD COLUMN birth_date DATE,
  ADD COLUMN nationality TEXT DEFAULT 'Việt Nam';
