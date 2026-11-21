import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class ProductService {
  async createProduct(businessId: string, name: string, description: string, price: number, quantity: number, category: string) {
    const productId = uuidv4();
    const slug = generateSlug(name);
    
    const result = await query(
      `INSERT INTO products (id, business_id, name, slug, description, price, stock, category, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       RETURNING *`,
      [productId, businessId, name, slug, description, price, quantity, category]
    );

    return result.rows[0];
  }

  async getProductsByBusiness(businessId: string) {
    const result = await query(
      'SELECT * FROM products WHERE business_id = $1 ORDER BY created_at DESC',
      [businessId]
    );
    return result.rows;
  }

  async getProductById(productId: string) {
    const result = await query('SELECT * FROM products WHERE id = $1', [productId]);
    return result.rows[0];
  }

  async updateProduct(productId: string, data: any) {
    const fields = Object.keys(data).map((key, idx) => `${key} = $${idx + 2}`).join(', ');
    const values = Object.values(data);
    
    const result = await query(
      `UPDATE products SET ${fields}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [productId, ...values]
    );

    return result.rows[0];
  }

  async deleteProduct(productId: string) {
    await query('DELETE FROM products WHERE id = $1', [productId]);
    return { success: true };
  }

  async decreaseQuantity(productId: string, quantity: number) {
    const result = await query(
      `UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING *`,
      [productId, quantity]
    );

    if (result.rows.length === 0) {
      throw new Error('Insufficient product quantity');
    }

    return result.rows[0];
  }
}

export default new ProductService();
