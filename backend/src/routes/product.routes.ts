import { Router } from 'express';
import ProductController from '../controllers/ProductController';
import { authMiddleware, requireBusinessAccess, requireProductAccess } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, requireBusinessAccess, (req, res) => ProductController.createProduct(req, res));
router.get('/business/:businessId', authMiddleware, requireBusinessAccess, (req, res) => ProductController.getProductsByBusiness(req, res));
router.get('/:id', authMiddleware, requireProductAccess, (req, res) => ProductController.getProduct(req, res));
router.put('/:id', authMiddleware, requireProductAccess, (req, res) => ProductController.updateProduct(req, res));
router.delete('/:id', authMiddleware, requireProductAccess, (req, res) => ProductController.deleteProduct(req, res));

export default router;
