import { Router } from 'express';
import OrderController from '../controllers/OrderController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, OrderController.createOrder);
router.get('/my-orders', authMiddleware, OrderController.getMyOrders);
router.get('/:orderId', authMiddleware, OrderController.getOrder);

export default router;
