-- Migration 005: Category CRUD, Barcode Scanning, and POS Counter fields

-- 1. Extend grocery_categories for landlord customization
ALTER TABLE grocery_categories
  ADD COLUMN IF NOT EXISTS created_by UUID,
  ADD COLUMN IF NOT EXISTS property_id UUID,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- 2. Extend orders for POS counter cash transactions
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_pos_counter BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cash_given NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cash_returned NUMERIC(14,2);

-- 3. Barcode indexes for ultra-fast scanner lookups (<5ms)
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_uoms_barcode ON product_uoms(barcode) WHERE barcode IS NOT NULL;

-- 4. Update demo products & packaging with realistic EAN barcodes for testing
UPDATE products SET barcode = '8934560111111' WHERE sku = 'P-HAO-HAO' AND barcode IS NULL;
UPDATE products SET barcode = '8935049500544' WHERE sku = 'P-COCA-320' AND barcode IS NULL;
UPDATE products SET barcode = '8936036010012' WHERE sku = 'P-LAVIE-500' AND barcode IS NULL;
UPDATE products SET barcode = '8934680031122' WHERE sku = 'P-OREO-120' AND barcode IS NULL;
UPDATE products SET barcode = '8934868112233' WHERE sku = 'P-OMO-2KG' AND barcode IS NULL;
UPDATE products SET barcode = '8939999000011' WHERE sku = 'P-COMBO-ROOM' AND barcode IS NULL;

-- Update packaging UOM barcodes
UPDATE product_uoms pu
SET barcode = '8934560111111'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-HAO-HAO' AND pu.uom_name = 'Gói' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8934560111112'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-HAO-HAO' AND pu.uom_name = 'Lốc 6 gói' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8934560111128'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-HAO-HAO' AND pu.uom_name = 'Thùng 30 gói' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8935049500544'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-COCA-320' AND pu.uom_name = 'Lon' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8935049500551'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-COCA-320' AND pu.uom_name = 'Lốc 6 lon' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8935049500568'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-COCA-320' AND pu.uom_name = 'Thùng 24 lon' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8936036010012'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-LAVIE-500' AND pu.uom_name = 'Chai' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8936036010029'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-LAVIE-500' AND pu.uom_name = 'Lốc 6 chai' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8936036010036'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-LAVIE-500' AND pu.uom_name = 'Thùng 24 chai' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8934680031122'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-OREO-120' AND pu.uom_name = 'Gói' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8934680031139'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-OREO-120' AND pu.uom_name = 'Hộp 3 gói' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8934868112233'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-OMO-2KG' AND pu.uom_name = 'Túi' AND pu.barcode IS NULL;

UPDATE product_uoms pu
SET barcode = '8939999000011'
FROM products p
WHERE pu.product_id = p.id AND p.sku = 'P-COMBO-ROOM' AND pu.uom_name = 'Combo' AND pu.barcode IS NULL;
