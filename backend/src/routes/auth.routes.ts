import { Router } from 'express';
import { upload } from '../services/UploadService';
import { getCustomerProfile, listCustomerAddresses, requireCustomer, saveCustomerAddress, updateCustomerProfile, uploadCustomerAvatar } from '../controllers/CustomerAccount';
import { lookupPostalCode } from '../services/DeliveryAddress';
import AuthController from '../controllers/AuthController';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/register', (req, res) => AuthController.register(req, res));
router.post('/login', (req, res) => AuthController.login(req, res));
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ id: req.userId, user_type: req.userType });
});

router.get('/postal-code/:cep', lookupPostalCode);
router.get('/me/profile', authMiddleware, requireCustomer, (req, res, next) => getCustomerProfile(req, res).catch(next));
router.put('/me/profile', authMiddleware, requireCustomer, (req, res, next) => updateCustomerProfile(req, res).catch(next));
router.post('/me/avatar', authMiddleware, requireCustomer, (req, res, next) => {
  upload.single('image')(req, res, (error) => {
    if (error) return res.status(400).json({ error: 'Envie uma imagem JPEG, PNG, WebP ou GIF de até 5 MB.' });
    return uploadCustomerAvatar(req, res).catch(next);
  });
});
router.get('/me/addresses', authMiddleware, requireCustomer, (req, res, next) => listCustomerAddresses(req, res).catch(next));
router.post('/me/addresses', authMiddleware, requireCustomer, (req, res, next) => saveCustomerAddress(req, res).catch(next));
router.put('/me/addresses/:id', authMiddleware, requireCustomer, (req, res, next) => saveCustomerAddress(req, res).catch(next));

export default router;
