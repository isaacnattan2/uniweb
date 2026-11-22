import { Router } from 'express';
import ShopController from '../controllers/ShopController';

const router = Router();

router.get('/businesses', ShopController.getAllBusinesses);
router.get('/businesses/:businessId', ShopController.getBusinessPublic);
router.get('/businesses/:businessId/products', ShopController.getProductsPublic);
router.get('/products/recent', ShopController.getRecentProducts);
router.get('/search', ShopController.searchProducts);

export default router;
