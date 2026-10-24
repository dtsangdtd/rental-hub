-- Migration 006: Category Foreign Key and Landlord Creator indexes

-- 1. Ensure foreign key index on products(category_id)
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- 2. Index on grocery_categories(created_by) for quick landlord category lookups
CREATE INDEX IF NOT EXISTS idx_grocery_categories_created_by ON grocery_categories(created_by);

-- 3. Backfill any products missing category_id by matching existing category slug
UPDATE products p
   SET category_id = gc.id
  FROM grocery_categories gc
 WHERE p.category_id IS NULL
   AND (p.category = gc.slug OR p.category = gc.name);
