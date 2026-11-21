import { Router } from 'express';
import BusinessController from '../controllers/BusinessController';
import { authMiddleware, requireAdmin, requireBusinessAccess } from '../middleware/auth';

const router = Router();

router.post('/', authMiddleware, requireAdmin, (req, res) => BusinessController.createBusiness(req, res));
router.get('/my-businesses', authMiddleware, (req, res) => BusinessController.getMyBusinesses(req, res));
router.get('/:id', authMiddleware, requireBusinessAccess, (req, res) => BusinessController.getBusiness(req, res));
router.put('/:id', authMiddleware, requireBusinessAccess, (req, res) => BusinessController.updateBusiness(req, res));

export default router;
