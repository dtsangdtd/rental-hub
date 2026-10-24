import { PoolClient } from 'pg';
import { conflict } from '@rental/common';

export interface BatchAllocation {
  batchId: string;
  allocatedQty: number;
  expDate: string;
}

/**
 * First-In, First-Out (FIFO) stock allocator based on earliest expiration date (exp_date ASC).
 * Uses row-level lock (FOR UPDATE) to guarantee atomic stock allocation without race conditions.
 */
export async function allocateStockFIFO(
  client: PoolClient,
  hubId: string,
  productId: string,
  requiredBaseQty: number,
): Promise<BatchAllocation[]> {
  const query = `
    SELECT id, exp_date, remaining_qty
      FROM inventory_batches
     WHERE hub_id = $1 AND product_id = $2 AND remaining_qty > 0
     ORDER BY exp_date ASC, created_at ASC
       FOR UPDATE
  `;

  const { rows: batches } = await client.query(query, [hubId, productId]);

  let needed = requiredBaseQty;
  const allocations: BatchAllocation[] = [];

  for (const batch of batches) {
    if (needed <= 0) break;
    const canTake = Math.min(Number(batch.remaining_qty), needed);
    if (canTake <= 0) continue;

    allocations.push({
      batchId: batch.id,
      allocatedQty: canTake,
      expDate: batch.exp_date ? String(batch.exp_date).slice(0, 10) : '',
    });

    needed -= canTake;
    await client.query(
      `UPDATE inventory_batches SET remaining_qty = remaining_qty - $1 WHERE id = $2`,
      [canTake, batch.id],
    );
  }

  if (needed > 0) {
    throw conflict(
      'OUT_OF_STOCK',
      `Kho tòa nhà không đủ số lượng tồn kho (thiếu ${needed} đơn vị cơ sở).`,
    );
  }

  return allocations;
}
