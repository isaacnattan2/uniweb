import { PoolClient } from 'pg';
import { getClient, query } from '../config/database';

export const cartProductId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export class CartError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type CartMutation =
  | { action: 'add' | 'set' | 'remove'; productId: string; quantity: number }
  | { action: 'merge'; items: Array<{ productId: string; quantity: number }> };

export async function lockCart(client: PoolClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 1))', [userId]);
}

const listSql = `SELECT p.id AS "productId", p.name, p.price::float8 AS price, c.quantity,
                       b.id AS "businessId", b.name AS "businessName"
                FROM customer_cart_items c
                JOIN products p ON p.id = c.product_id
                JOIN businesses b ON b.id = p.business_id
                JOIN users u ON u.id = b.owner_id
                WHERE c.user_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL
                  AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
                ORDER BY b.id, p.id`;

export async function listCart(userId: string) {
  return (await query(listSql, [userId])).rows;
}

export async function mutateCart(userId: string, change: CartMutation) {
  const client = await getClient();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    await lockCart(client, userId);
    if (change.action === 'remove') {
      await client.query('DELETE FROM customer_cart_items WHERE user_id = $1 AND product_id = $2', [userId, change.productId]);
    } else if (change.action === 'merge') {
      const items = new Map(change.items.map((item) => [item.productId, item.quantity]));
      if (items.size) {
        await client.query(
          `INSERT INTO customer_cart_items (user_id, product_id, quantity)
           SELECT $1, p.id, LEAST(x.quantity, GREATEST(p.stock, 1))
           FROM UNNEST($2::uuid[], $3::int[]) AS x(id, quantity)
           JOIN products p ON p.id = x.id
           JOIN businesses b ON b.id = p.business_id JOIN users u ON u.id = b.owner_id
           WHERE p.status = 'active' AND p.deleted_at IS NULL AND b.status = 'active'
             AND b.deleted_at IS NULL AND u.status = 'active'
           ON CONFLICT (user_id, product_id) DO UPDATE
           SET quantity = GREATEST(customer_cart_items.quantity, EXCLUDED.quantity)`,
          [userId, [...items.keys()], [...items.values()]]
        );
      }
    } else {
      const result = await client.query(
        `SELECT p.stock FROM products p
         JOIN businesses b ON b.id = p.business_id JOIN users u ON u.id = b.owner_id
         WHERE p.id = $1 AND p.status = 'active' AND p.deleted_at IS NULL
           AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'`, [change.productId]
      );
      if (!result.rows.length) throw new CartError(409, 'Este produto está indisponível.');
      const stock = result.rows[0].stock;
      if (stock < change.quantity) throw new CartError(409, 'Estoque insuficiente para essa quantidade.');
      if (change.action === 'set') {
        await client.query('UPDATE customer_cart_items SET quantity = $3 WHERE user_id = $1 AND product_id = $2',
          [userId, change.productId, change.quantity]);
      } else {
        const updated = await client.query(
          `INSERT INTO customer_cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = customer_cart_items.quantity + EXCLUDED.quantity
           WHERE customer_cart_items.quantity::bigint + EXCLUDED.quantity <= $4
           RETURNING product_id`, [userId, change.productId, change.quantity, stock]
        );
        if (!updated.rows.length) throw new CartError(409, 'Você já atingiu o estoque disponível para este produto.');
      }
    }
    const items = await client.query(listSql, [userId]);
    await client.query('COMMIT');
    return items.rows;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      releaseError = new Error('Falha ao desfazer atualização do carrinho');
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
