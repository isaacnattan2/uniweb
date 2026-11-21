import { Router } from 'express';
import AuthController from '../controllers/AuthController';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/register', (req, res) => AuthController.register(req, res));
router.post('/login', (req, res) => AuthController.login(req, res));
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ id: req.userId, user_type: req.userType });
});

export default router;
