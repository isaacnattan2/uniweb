import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

export type BusinessUpdate = Partial<Record<'name' | 'description' | 'category', string | null>> & { payment_methods?: string[] };

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
    const fields = Object.keys(data).map((key, idx) => `${key} = $${idx + 2}`).join(', ');
    const values = Object.values(data);
    const ownerCondition = ownerId ? ` AND owner_id = $${values.length + 2}` : '';
    
    const result = await query(
      `UPDATE businesses SET ${fields}, updated_at = NOW() WHERE id = $1${ownerCondition} RETURNING *`,
      ownerId ? [businessId, ...values, ownerId] : [businessId, ...values]
    );

    return result.rows[0];
  }
}

export default new BusinessService();
