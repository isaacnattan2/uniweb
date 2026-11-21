import { Response } from 'express';
import { query } from '../config/database';

export class ProductImageService {
  async addImages(productId: string, imageUrls: string[]) {
    try {
      for (let i = 0; i < imageUrls.length; i++) {
        await query(
          `INSERT INTO product_images (product_id, image_url, order_index)
           VALUES ($1, $2, $3)`,
          [productId, imageUrls[i], i]
        );
      }
      return true;
    } catch (error) {
      console.error('Error adding images:', error);
      throw error;
    }
  }

  async getProductImages(productId: string) {
    try {
      const result = await query(
        `SELECT id, image_url, order_index FROM product_images
         WHERE product_id = $1
         ORDER BY order_index ASC`,
        [productId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching images:', error);
      throw error;
    }
  }

  async deleteImage(imageId: string) {
    try {
      await query(
        `DELETE FROM product_images WHERE id = $1`,
        [imageId]
      );
      return true;
    } catch (error) {
      console.error('Error deleting image:', error);
      throw error;
    }
  }

  async deleteProductImages(productId: string) {
    try {
      await query(
        `DELETE FROM product_images WHERE product_id = $1`,
        [productId]
      );
      return true;
    } catch (error) {
      console.error('Error deleting product images:', error);
      throw error;
    }
  }
}

export default new ProductImageService();
