import { listPublishedAds } from '../controllers/MarketplaceAd';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getMarketplaceComments, getMyMarketplaceReview, rateMarketplaceItem } from '../controllers/MarketplaceReview';
import ShopController from '../controllers/ShopController';

const router = Router();

router.get('/categories', ShopController.getCategories);
router.get('/reviews/:kind/:id', getMarketplaceComments);
router.get('/reviews/:kind/:id/mine', authMiddleware, getMyMarketplaceReview);
router.put('/reviews/:kind/:id', authMiddleware, rateMarketplaceItem);
router.get('/businesses', ShopController.getAllBusinesses);
router.get('/businesses/:businessId', ShopController.getBusinessPublic);
router.get('/businesses/:businessId/products', ShopController.getProductsPublic);
router.get('/products/recent', ShopController.getRecentProducts);
router.get('/search', ShopController.searchProducts);

router.get('/ads', (req, res, next) => listPublishedAds(req, res).catch(next));

export default router;
