-- Migration 007: Cleanup any legacy sample demo grocery data from database
-- Ensures databases that previously executed 004 are cleaned of hardcoded demo records.

DO $$
BEGIN
  -- 1. Remove demo order allocations and items if any exist
  DELETE FROM order_item_batch_allocations
   WHERE order_item_id IN (
     SELECT id FROM order_items
      WHERE product_id::text LIKE 'b0000000-%'
   );

  DELETE FROM order_items WHERE product_id::text LIKE 'b0000000-%';
  DELETE FROM orders WHERE hub_id = 'a0000000-0000-0000-0000-000000000001';

  -- 2. Remove demo batches and inventory stocks
  DELETE FROM inventory_batches
   WHERE hub_id = 'a0000000-0000-0000-0000-000000000001'
      OR product_id::text LIKE 'b0000000-%';

  DELETE FROM hub_inventory_stocks
   WHERE hub_id = 'a0000000-0000-0000-0000-000000000001'
      OR product_id::text LIKE 'b0000000-%';

  -- 3. Remove packaging units and products
  DELETE FROM product_uoms WHERE product_id::text LIKE 'b0000000-%';
  DELETE FROM products WHERE id::text LIKE 'b0000000-%';

  -- 4. Remove demo hub
  DELETE FROM inventory_hubs WHERE id = 'a0000000-0000-0000-0000-000000000001';
END $$;
