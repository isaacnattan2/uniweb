import { Router } from 'express';
import { deleteCoupon, listCoupons, saveCoupon } from '../services/StoreCoupons';
import BusinessController from '../controllers/BusinessController';
import { listStoreOrders, updateStoreOrder } from '../controllers/StoreOrders';
import { authMiddleware, requireAdmin, requireBusinessAccess } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, requireAdmin, (req, res) => BusinessController.createBusiness(req, res));
router.get('/my-businesses', authMiddleware, (req, res) => BusinessController.getMyBusinesses(req, res));
router.get('/:id', authMiddleware, requireBusinessAccess, (req, res) => BusinessController.getBusiness(req, res));
router.put('/:id', authMiddleware, requireBusinessAccess, (req, res) => BusinessController.updateBusiness(req, res));
router.get('/:id/orders', authMiddleware, requireBusinessAccess, (req, res, next) => listStoreOrders(req, res).catch(next));
router.patch('/:id/orders/:orderId', authMiddleware, requireBusinessAccess, (req, res, next) => updateStoreOrder(req, res).catch(next));

router.get('/:id/coupons', authMiddleware, requireBusinessAccess, (req, res, next) => listCoupons(req, res).catch(next));
router.post('/:id/coupons', authMiddleware, requireBusinessAccess, (req, res, next) => saveCoupon(req, res).catch(next));
router.put('/:id/coupons/:couponId', authMiddleware, requireBusinessAccess, (req, res, next) => saveCoupon(req, res).catch(next));
router.delete('/:id/coupons/:couponId', authMiddleware, requireBusinessAccess, (req, res, next) => deleteCoupon(req, res).catch(next));

export default router;
