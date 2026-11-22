import { Router } from 'express';
import { asaasWebhook } from '../controllers/AsaasWebhook';
import { lookupPostalCode } from '../services/DeliveryAddress';
import OrderController from '../controllers/OrderController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/asaas/webhook', asaasWebhook);
router.post('/checkout', authMiddleware, (req, res) => OrderController.createOrder(req, res, true));
router.post('/', authMiddleware, (req, res) => OrderController.createOrder(req, res));
router.get('/my-orders', authMiddleware, OrderController.getMyOrders);
router.get('/postal-code/:cep', authMiddleware, lookupPostalCode);
router.get('/:orderId', authMiddleware, OrderController.getOrder);

export default router;
