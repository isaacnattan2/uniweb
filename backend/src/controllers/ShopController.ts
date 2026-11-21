import { Response } from 'express';
import { query } from '../config/database';
import ProductImageService from '../services/ProductImageService';

export class ShopController {
  async getAllBusinesses(req: any, res: Response) {
    try {
      const result = await query(
        `SELECT id, name, description, category, logo_url, rating, status 
         FROM businesses 
         WHERE status = 'active' 
         ORDER BY created_at DESC`
      );
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getBusinessPublic(req: any, res: Response) {
    try {
      const { businessId } = req.params;
      const result = await query(
        `SELECT id, name, description, category, logo_url, rating, status 
         FROM businesses 
         WHERE id = $1 AND status = 'active'`,
        [businessId]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Business not found' });
      }

      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getProductsPublic(req: any, res: Response) {
    try {
      const { businessId } = req.params;
      const result = await query(
        `SELECT id, business_id, name, description, price, stock, category, rating, status 
         FROM products 
         WHERE business_id = $1 AND status = 'active'
         ORDER BY created_at DESC`,
        [businessId]
      );
      
      for (let product of result.rows) {
        const images = await ProductImageService.getProductImages(product.id);
        product.images = images;
      }
      
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async searchProducts(req: any, res: Response) {
    try {
      const { q } = req.query;
      if (!q || q.length < 2) {
        return res.status(400).json({ error: 'Search query too short' });
      }

      const result = await query(
        `SELECT p.id, p.business_id, p.name, p.description, p.price, p.stock, p.category, p.rating, p.status,
                b.name as business_name
         FROM products p
         JOIN businesses b ON p.business_id = b.id
         WHERE (p.name ILIKE $1 OR p.description ILIKE $1) AND p.status = 'active' AND b.status = 'active'
         ORDER BY p.created_at DESC
         LIMIT 20`,
        [`%${q}%`]
      );
      
      for (let product of result.rows) {
        const images = await ProductImageService.getProductImages(product.id);
        product.images = images;
      }
      
      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new ShopController();
