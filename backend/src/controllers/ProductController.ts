import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import ProductService from '../services/ProductService';
import ProductImageService from '../services/ProductImageService';

export class ProductController {
  async createProduct(req: AuthRequest, res: Response) {
    try {
      const { businessId, name, description, price, quantity, category, images } = req.body;
      
      if (!businessId || !name || !price) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const product = await ProductService.createProduct(businessId, name, description, price, quantity, category);
      
      if (images && images.length > 0) {
        await ProductImageService.addImages(product.id, images);
      }

      res.status(201).json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getProductsByBusiness(req: AuthRequest, res: Response) {
    try {
      const { businessId } = req.params;
      const products = await ProductService.getProductsByBusiness(businessId);
      
      for (let product of products) {
        const images = await ProductImageService.getProductImages(product.id);
        product.images = images;
      }
      
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getProduct(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const product = await ProductService.getProductById(id);
      
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const images = await ProductImageService.getProductImages(id);
      product.images = images;

      res.json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateProduct(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { images, quantity, ...updateData } = req.body;
      const allowed = ['name', 'description', 'price', 'category', 'status', 'stock'];
      if (Object.keys(updateData).some((key) => !allowed.includes(key)) ||
          (images !== undefined && (!Array.isArray(images) || images.some((image: unknown) => typeof image !== 'string')))) {
        return res.status(400).json({ error: 'Campos de produto inválidos' });
      }
      if (quantity !== undefined) {
        updateData.stock = quantity;
      }
      if (!Object.keys(updateData).length) {
        return res.status(400).json({ error: 'Informe os dados do produto' });
      }
      
      const product = await ProductService.updateProduct(id, updateData);

      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      if (Array.isArray(images)) {
        await ProductImageService.deleteProductImages(id);
        if (images.length > 0) {
          await ProductImageService.addImages(id, images);
        }
      }
      
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteProduct(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      await ProductImageService.deleteProductImages(id);
      await ProductService.deleteProduct(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async addProductImages(req: AuthRequest, res: Response) {
    try {
      const { productId } = req.params;
      const { images } = req.body;
      
      if (!images || images.length === 0) {
        return res.status(400).json({ error: 'No images provided' });
      }

      await ProductImageService.addImages(productId, images);
      const updatedImages = await ProductImageService.getProductImages(productId);
      
      res.json({ images: updatedImages });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async deleteProductImage(req: AuthRequest, res: Response) {
    try {
      const { imageId } = req.params;
      await ProductImageService.deleteImage(imageId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new ProductController();
