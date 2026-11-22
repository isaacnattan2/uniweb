import { Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

const codePattern = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase();
}

export class CouponError extends Error {}

export interface Coupon {
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  scope: 'store' | 'category' | 'products';
  category: string | null;
  product_ids: string[];
}

export function applyCoupon<T extends { subtotal: bigint; product: { id: string; category: string | null } }>(
  items: T[], coupon: Coupon
): Array<T & { discount: bigint }> {
  const eligible = (item: T) => coupon.scope === 'store' ||
    (coupon.scope === 'category' && item.product.category?.trim().toLowerCase() === coupon.category) ||
    (coupon.scope === 'products' && coupon.product_ids.includes(item.product.id));
  const base = items.reduce((amount, item) => amount + (eligible(item) ? item.subtotal : 0n), 0n);
  if (!base) throw new CouponError('O cupom não se aplica aos itens desta compra.');
  const value = BigInt(coupon.discount_value);
  const total = coupon.discount_type === 'percent' ? (base * value + 5000n) / 10000n : value < base ? value : base;
  if (!total) throw new CouponError('O desconto é inferior a um centavo para esta compra.');
  let previousBase = 0n;
  return items.map((item) => {
    const nextBase = previousBase + (eligible(item) ? item.subtotal : 0n);
    const discount = total * nextBase / base - total * previousBase / base;
    previousBase = nextBase;
    return { ...item, discount };
  });
}

export async function listCoupons(req: AuthRequest, res: Response) {
  const result = await query('SELECT * FROM business_coupons WHERE business_id = $1 ORDER BY code', [req.params.id]);
  res.json(result.rows);
}

export async function saveCoupon(req: AuthRequest, res: Response) {
  const { id: businessId, couponId } = req.params;
  const { code, discountType, discountValue, scope, category, productIds, active } = req.body || {};
  const normalizedCode = typeof code === 'string' ? normalizeCouponCode(code) : '';
  const categoryValue = scope === 'category' && typeof category === 'string' ? category.trim().toLowerCase() : null;
  const ids = scope === 'products' && Array.isArray(productIds) ? productIds : [];
  if ((couponId && !uuidPattern.test(couponId)) || !codePattern.test(normalizedCode) ||
      !['percent', 'fixed'].includes(discountType) || !Number.isInteger(discountValue) || discountValue < 1 ||
      discountValue > (discountType === 'percent' ? 10000 : 2147483647) || typeof active !== 'boolean' ||
      !['store', 'category', 'products'].includes(scope) ||
      (scope === 'category' && (!categoryValue || categoryValue.length > 100)) ||
      (scope === 'products' && (!ids.length || ids.length > 100 ||
        ids.some((id) => typeof id !== 'string' || !uuidPattern.test(id))))) {
    return res.status(400).json({ error: 'Revise o código, o desconto e os itens elegíveis do cupom.' });
  }
  const uniqueIds = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (scope === 'products') {
    const result = await query(
      'SELECT id FROM products WHERE business_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL',
      [businessId, uniqueIds]
    );
    if (result.rows.length !== uniqueIds.length) return res.status(400).json({ error: 'Selecione produtos desta loja.' });
  }
  if (categoryValue) {
    const result = await query(
      `SELECT 1 FROM marketplace_categories WHERE kind = 'product' AND value = $1
       UNION ALL SELECT 1 FROM products WHERE business_id = $2 AND LOWER(TRIM(category)) = $1 AND deleted_at IS NULL
       LIMIT 1`, [categoryValue, businessId]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Selecione uma categoria válida.' });
  }
  try {
    const values = [businessId, normalizedCode, discountType, discountValue, scope, categoryValue, uniqueIds, active];
    const result = couponId
      ? await query(
          `UPDATE business_coupons SET code = $2, discount_type = $3, discount_value = $4,
             scope = $5, category = $6, product_ids = $7, active = $8
           WHERE business_id = $1 AND id = $9 RETURNING *`, [...values, couponId]
        )
      : await query(
          `INSERT INTO business_coupons (business_id, code, discount_type, discount_value, scope, category, product_ids, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, values
        );
    if (!result.rows.length) return res.status(404).json({ error: 'Cupom não encontrado.' });
    return res.status(couponId ? 200 : 201).json(result.rows[0]);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'Já existe um cupom com esse código nesta loja.' });
    }
    throw error;
  }
}

export async function deleteCoupon(req: AuthRequest, res: Response) {
  if (!uuidPattern.test(req.params.couponId)) return res.status(400).json({ error: 'Cupom inválido.' });
  const result = await query('DELETE FROM business_coupons WHERE business_id = $1 AND id = $2', [req.params.id, req.params.couponId]);
  if (!result.rowCount) return res.status(404).json({ error: 'Cupom não encontrado.' });
  return res.sendStatus(204);
}
