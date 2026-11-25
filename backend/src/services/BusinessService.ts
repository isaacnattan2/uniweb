import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

export type BusinessUpdate = Partial<Record<'name' | 'description' | 'category' | 'address', string | null>> & { payment_methods?: string[]; max_card_installments?: number; card_payment_configured?: boolean };

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class CardSplitLimitError extends Error {}

export class BusinessService {
  async createBusiness(ownerId: string, name: string, description: string, category: string) {
    const businessId = uuidv4();
    const slug = generateSlug(name);
    
    const result = await query(
      `INSERT INTO businesses (id, owner_id, name, slug, description, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
      [businessId, ownerId, name, slug, description, category]
    );

    return result.rows[0];
  }

  async getBusinessById(businessId: string) {
    const result = await query('SELECT * FROM businesses WHERE id = $1', [businessId]);
    return result.rows[0];
  }

  async getBusinessesByOwner(ownerId: string) {
    const result = await query('SELECT * FROM businesses WHERE owner_id = $1', [ownerId]);
    return result.rows;
  }

  async updateBusiness(businessId: string, data: BusinessUpdate, ownerId?: string) {
    const keys = Object.keys(data);
    const fields = keys.map((key, idx) => `${key} = $${idx + 2}`).join(', ');
    const values = Object.values(data);
    const paymentMethodsIndex = keys.indexOf('payment_methods');
    const installmentsIndex = keys.indexOf('max_card_installments');
    const ownerCondition = ownerId ? ` AND owner_id = $${values.length + 2}` : '';
    
    const editingCard = paymentMethodsIndex !== -1 || installmentsIndex !== -1;
    const nextMethods = paymentMethodsIndex === -1 ? 'payment_methods' : '$' + (paymentMethodsIndex + 2) + '::text[]';
    const nextLimit = installmentsIndex === -1 ? 'max_card_installments' : '$' + (installmentsIndex + 2) + '::int';
    const cardCondition = editingCard
      ? ` AND NOT (COALESCE(asaas_card_split_condition->>'mode' = 'fixed' AND asaas_card_split_condition->>'ownerId' = owner_id::text, false)
        AND COALESCE('credit_card' = ANY(${nextMethods}), false) AND ${nextLimit} > 1)`
      : '';
    const result = await query(
      `UPDATE businesses SET ${fields}, updated_at = NOW() WHERE id = $1${ownerCondition}${cardCondition} RETURNING *`,
      ownerId ? [businessId, ...values, ownerId] : [businessId, ...values]
    );

    if (!result.rows.length && editingCard) {
      const accessible = await query(
        'SELECT 1 FROM businesses WHERE id = $1' + (ownerId ? ' AND owner_id = $2' : ''),
        ownerId ? [businessId, ownerId] : [businessId],
      );
      if (accessible.rows.length) throw new CardSplitLimitError('Para habilitar mais de uma parcela, peça ao admin para atualizar o split fixo do cartão para percentual.');
    }
    return result.rows[0];
  }
}

export default new BusinessService();
