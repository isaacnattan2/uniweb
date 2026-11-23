import { Router } from 'express';
import { acceptDelivery, listAcceptedDeliveries, listAvailableDeliveries } from '../controllers/AvailableDeliveries';
import { cancelDelivery, confirmDelivery } from '../controllers/ConfirmDelivery';
import { cancelCustomerOrder } from '../controllers/CustomerOrderCancellation';
import { clearDeliveryTracking, getDeliveryRoute, getDeliveryTracking, updateDeliveryTracking } from '../controllers/DeliveryTracking';
import { asaasWebhook } from '../controllers/AsaasWebhook';
import { lookupPostalCode } from '../services/DeliveryAddress';
import OrderController from '../controllers/OrderController';
import { authMiddleware } from '../middleware/auth';
import { quoteDelivery, respondDispatch, markDeliveryPickedUp, listDeliveryAlternatives, rescheduleDelivery } from '../controllers/DeliveryDispatch';

const router = Router();

router.post('/asaas/webhook', asaasWebhook);
router.post('/checkout', authMiddleware, (req, res) => OrderController.createOrder(req, res, true));
router.post('/delivery-quote', authMiddleware, (req, res, next) => quoteDelivery(req, res).catch(next));
router.post('/', authMiddleware, (req, res) => OrderController.createOrder(req, res));
router.get('/my-orders', authMiddleware, OrderController.getMyOrders);
router.get('/postal-code/:cep', authMiddleware, lookupPostalCode);
router.get('/available-deliveries', authMiddleware, listAvailableDeliveries);
router.post('/available-deliveries/:orderId/accept', authMiddleware, acceptDelivery);
router.post('/available-deliveries/:orderId/respond', authMiddleware, (req, res, next) => respondDispatch(req, res).catch(next));
router.get('/accepted-deliveries', authMiddleware, listAcceptedDeliveries);
router.post('/accepted-deliveries/:orderId/confirm', authMiddleware, confirmDelivery);
router.post('/accepted-deliveries/:orderId/pickup', authMiddleware, (req, res, next) => markDeliveryPickedUp(req, res).catch(next));
router.post('/accepted-deliveries/:orderId/cancel', authMiddleware, cancelDelivery);
router.get('/:orderId/tracking', authMiddleware, (req, res, next) => getDeliveryTracking(req, res).catch(next));
router.put('/accepted-deliveries/:orderId/tracking', authMiddleware, (req, res, next) => updateDeliveryTracking(req, res).catch(next));
router.delete('/accepted-deliveries/:orderId/tracking', authMiddleware, (req, res, next) => clearDeliveryTracking(req, res).catch(next));
router.post('/accepted-deliveries/:orderId/route', authMiddleware, (req, res, next) => getDeliveryRoute(req, res).catch(next));
router.get('/:orderId', authMiddleware, OrderController.getOrder);
router.get('/:orderId/delivery-alternatives', authMiddleware, (req, res, next) => listDeliveryAlternatives(req, res).catch(next));
router.put('/:orderId/delivery-alternatives', authMiddleware, (req, res, next) => rescheduleDelivery(req, res).catch(next));
router.post('/:orderId/cancel', authMiddleware, (req, res, next) => cancelCustomerOrder(req, res).catch(next));

export default router;
