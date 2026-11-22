import { Request, Response } from 'express';
import { query } from '../config/database';
import ProductImageService from '../services/ProductImageService';

async function listMarketplaceProducts(search?: string, category?: string) {
  const searchFilter = search ? ' AND (p.name ILIKE $1 OR p.description ILIKE $1)' : '';
  const stockPriority = search ? '' : '(stock > 0) DESC NULLS LAST, ';
  const categoryFilter = category ? ' AND LOWER(TRIM(p.category)) = ' + (search ? '$2' : '$1') : '';
  const products = await query(
    `WITH latest AS (
       SELECT p.id, p.business_id, p.name, p.description, p.price, p.stock, p.category, p.rating, p.rating_count, p.status,
              b.name AS business_name, p.created_at
       FROM products p
       JOIN businesses b ON b.id = p.business_id
       JOIN users u ON u.id = b.owner_id
       WHERE p.status = 'active' AND b.status = 'active'${searchFilter}${categoryFilter}
         AND p.deleted_at IS NULL AND b.deleted_at IS NULL AND u.status = 'active'
       ORDER BY ${stockPriority}p.created_at DESC, p.id DESC
       LIMIT 20
     )
     SELECT latest.*, COALESCE(images.items, '[]'::json) AS images
     FROM latest
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('id', i.id, 'image_url', i.image_url, 'order_index', i.order_index)
                       ORDER BY i.order_index, i.id) AS items
       FROM product_images i WHERE i.product_id = latest.id
     ) images ON true
     ORDER BY ${stockPriority}latest.created_at DESC, latest.id DESC`,
    [...(search ? [search] : []), ...(category ? [category] : [])]
  );
  return products.rows;
}

function readCategory(req: Request) {
  return typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : undefined;
}

export class ShopController {
  async getCategories(_req: Request, res: Response) {
    try {
      const categories = await query(
        `WITH available AS (
           SELECT kind, value, label, 0 AS priority FROM marketplace_categories
           UNION ALL
           SELECT 'product', LOWER(TRIM(category)), MIN(TRIM(category)), 1 FROM products
           WHERE category IS NOT NULL AND TRIM(category) <> '' AND deleted_at IS NULL
           GROUP BY LOWER(TRIM(category))
           UNION ALL
           SELECT 'business', LOWER(TRIM(category)), MIN(TRIM(category)), 1 FROM businesses
           WHERE category IS NOT NULL AND TRIM(category) <> '' AND deleted_at IS NULL
           GROUP BY LOWER(TRIM(category))
         )
         SELECT kind, value, label FROM (
           SELECT DISTINCT ON (kind, value) kind, value, label
           FROM available ORDER BY kind, value, priority
         ) options ORDER BY kind, label`
      );
      res.json(categories.rows);
    } catch (error) {
      console.error('Falha ao carregar categorias:', error);
      res.status(500).json({ error: 'Não foi possível carregar as categorias.' });
    }
  }

  async getRecentProducts(req: Request, res: Response) {
    try {
      res.json(await listMarketplaceProducts(undefined, readCategory(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getAllBusinesses(req: any, res: Response) {
    try {
      const result = await query(
        `SELECT b.id, b.name, b.description, b.category, COALESCE(c.label, b.category) AS category_label, b.logo_url, b.rating, b.rating_count, b.status
         FROM businesses b JOIN users u ON u.id = b.owner_id
         LEFT JOIN marketplace_categories c ON c.kind = 'business' AND c.value = LOWER(TRIM(b.category))
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
        `SELECT b.id, b.name, b.description, b.category, COALESCE(c.label, b.category) AS category_label, b.logo_url, b.rating, b.rating_count, b.status, b.payment_methods, b.max_card_installments
         FROM businesses b JOIN users u ON u.id = b.owner_id
         LEFT JOIN marketplace_categories c ON c.kind = 'business' AND c.value = LOWER(TRIM(b.category))
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
        `SELECT p.id, p.business_id, p.name, p.description, p.price, p.stock, p.category, COALESCE(c.label, p.category) AS category_label, p.rating, p.rating_count, p.status
         FROM products p JOIN businesses b ON b.id = p.business_id JOIN users u ON u.id = b.owner_id
         LEFT JOIN marketplace_categories c ON c.kind = 'product' AND c.value = LOWER(TRIM(p.category))
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

      res.json(await listMarketplaceProducts('%' + q.trim() + '%', readCategory(req)));
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new ShopController();
