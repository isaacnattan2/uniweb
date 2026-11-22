import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { requireCustomer } from '../controllers/CustomerAccount';
import { CartError, CartMutation, cartProductId, listCart, mutateCart } from '../services/CustomerCart';

const router = Router();
router.use(authMiddleware, requireCustomer);

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    res.json(await listCart(req.userId!));
  } catch (error) {
    next(error);
  }
});

const validQuantity = (quantity: unknown) =>
  typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 1 && quantity <= 2147483647;

router.post('/', async (req: AuthRequest, res, next) => {
  const { action, productId, quantity, items } = req.body || {};
  let change: CartMutation;
  if (action === 'merge' && Array.isArray(items) && items.length <= 1000 &&
      items.every((item) => item && typeof item.productId === 'string' && cartProductId.test(item.productId) && validQuantity(item.quantity))) {
    change = { action, items: items.map((item) => ({ productId: item.productId.toLowerCase(), quantity: item.quantity })) };
  } else if (['add', 'set', 'remove'].includes(action) && typeof productId === 'string' && cartProductId.test(productId) &&
      (action === 'remove' || validQuantity(quantity))) {
    change = { action, productId, quantity };
  } else {
    return res.status(400).json({ error: 'Alteração de carrinho inválida.' });
  }
  try {
    return res.json(await mutateCart(req.userId!, change));
  } catch (error) {
    if (error instanceof CartError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

export default router;
