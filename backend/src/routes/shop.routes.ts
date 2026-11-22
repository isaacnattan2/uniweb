import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { rateMarketplaceItem } from '../controllers/MarketplaceReview';
import ShopController from '../controllers/ShopController';

const router = Router();

router.get('/categories', ShopController.getCategories);
router.put('/reviews/:kind/:id', authMiddleware, rateMarketplaceItem);
router.get('/businesses', ShopController.getAllBusinesses);
router.get('/businesses/:businessId', ShopController.getBusinessPublic);
router.get('/businesses/:businessId/products', ShopController.getProductsPublic);
router.get('/products/recent', ShopController.getRecentProducts);
router.get('/search', ShopController.searchProducts);

export default router;
