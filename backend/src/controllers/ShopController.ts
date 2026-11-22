import { Request, Response } from 'express';
import { query } from '../config/database';
import ProductImageService from '../services/ProductImageService';

async function listMarketplaceProducts(search?: string) {
  const filter = search ? '(p.name ILIKE $1 OR p.description ILIKE $1)' : 'p.stock > 0';
  const products = await query(
    `WITH latest AS (
       SELECT p.id, p.business_id, p.name, p.description, p.price, p.stock, p.category, p.rating, p.status,
              b.name AS business_name, p.created_at
       FROM products p
       JOIN businesses b ON b.id = p.business_id
       JOIN users u ON u.id = b.owner_id
       WHERE ${filter} AND p.status = 'active' AND b.status = 'active'
         AND p.deleted_at IS NULL AND b.deleted_at IS NULL AND u.status = 'active'
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 20
     )
     SELECT latest.*, COALESCE(images.items, '[]'::json) AS images
     FROM latest
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('id', i.id, 'image_url', i.image_url, 'order_index', i.order_index)
                       ORDER BY i.order_index, i.id) AS items
       FROM product_images i WHERE i.product_id = latest.id
     ) images ON true
     ORDER BY latest.created_at DESC, latest.id DESC`,
    search ? [search] : []
  );
  return products.rows;
}

export class ShopController {
  async getRecentProducts(_req: Request, res: Response) {
    try {
      res.json(await listMarketplaceProducts());
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getAllBusinesses(req: any, res: Response) {
    try {
      const result = await query(
        `SELECT b.id, b.name, b.description, b.category, b.logo_url, b.rating, b.status
         FROM businesses b JOIN users u ON u.id = b.owner_id
         WHERE b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
         ORDER BY b.created_at DESC`
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
        `SELECT b.id, b.name, b.description, b.category, b.logo_url, b.rating, b.status, b.payment_methods, b.max_card_installments
         FROM businesses b JOIN users u ON u.id = b.owner_id
         WHERE b.deleted_at IS NULL AND b.id = $1 AND b.status = 'active' AND u.status = 'active'`,
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
        `SELECT p.id, p.business_id, p.name, p.description, p.price, p.stock, p.category, p.rating, p.status
         FROM products p JOIN businesses b ON b.id = p.business_id JOIN users u ON u.id = b.owner_id
         WHERE p.business_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL
           AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
         ORDER BY p.created_at DESC`,
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

  async searchProducts(req: Request, res: Response) {
    try {
      const { q } = req.query;
      if (typeof q !== 'string' || q.trim().length < 2) {
        return res.status(400).json({ error: 'Search query too short' });
      }

      res.json(await listMarketplaceProducts('%' + q.trim() + '%'));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new ShopController();
