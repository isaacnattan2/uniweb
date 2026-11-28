import { customerCards } from '../controllers/CustomerCards';
import { listDriverNotifications, markDriverNotificationRead } from '../controllers/DriverNotifications';
import { saveDriverLicensePhoto } from '../controllers/DriverLicensePhoto';
import { Router } from 'express';
import { driverPushAlias, signStorePushIdentity } from '../services/OrderPush';
import { upload } from '../services/UploadService';
import { getCustomerProfile, listCustomerAddresses, requireCustomer, saveCustomerAddress, updateCustomerProfile, uploadProfileAvatar } from '../controllers/CustomerAccount';
import { lookupPostalCode } from '../services/DeliveryAddress';
import { getDriverRegistration, registerDriver, updateDriverRegistration } from '../controllers/DriverRegistration';
import { readMyDeliveryRate, updateMyDeliveryRate } from '../controllers/DriverDeliveryRates';
import AuthController from '../controllers/AuthController';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { changeDriverShift, changeDriverWeeklyShift, readDriverDispatch, updateDriverPresence } from '../controllers/DeliveryDispatch';

import { createDriverAsaasAccount } from '../controllers/StoreAsaasOnboarding';
import { getDriverWithdrawals } from '../controllers/StoreWithdrawals';

const router = Router();

router.post('/register', (req, res) => AuthController.register(req, res));
router.post('/register/driver', (req, res, next) => registerDriver(req, res).catch(next));
router.post('/login', (req, res) => AuthController.login(req, res));
router.get('/me/cards', authMiddleware, customerCards);
router.post('/me/cards', authMiddleware, customerCards);
router.delete('/me/cards/:id', authMiddleware, customerCards);
router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ id: req.userId, user_type: req.userType });
});

router.get('/me/push-identity', authMiddleware, (req: AuthRequest, res) => {
  if (!req.userId || !req.userType || (req.userType === 'admin' && req.query.channel !== 'web')) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  if (req.userType === 'driver' && req.query.channel !== 'web') {
    const externalId = driverPushAlias(req.userId);
    return externalId ? res.json({ externalId }) : res.sendStatus(503);
  }
  const token = signStorePushIdentity(req.userId);
  if (!token) return res.sendStatus(503);
  return res.json({ externalId: req.userId, token });
});

router.get('/postal-code/:cep', lookupPostalCode);
router.get('/me/profile', authMiddleware, requireCustomer, (req, res, next) => getCustomerProfile(req, res).catch(next));
router.put('/me/profile', authMiddleware, requireCustomer, (req, res, next) => updateCustomerProfile(req, res).catch(next));
router.post('/me/avatar', authMiddleware, (req: AuthRequest, res, next) => {
  if (!req.userId || (req.userType !== 'customer' && req.userType !== 'driver')) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  upload.single('image')(req, res, (error) => {
    if (error) return res.status(400).json({ error: 'Envie uma imagem JPEG, PNG, WebP ou GIF de até 5 MB.' });
    return uploadProfileAvatar(req, res).catch(next);
  });
});
router.get('/me/addresses', authMiddleware, requireCustomer, (req, res, next) => listCustomerAddresses(req, res).catch(next));
router.post('/me/addresses', authMiddleware, requireCustomer, (req, res, next) => saveCustomerAddress(req, res).catch(next));
router.put('/me/addresses/:id', authMiddleware, requireCustomer, (req, res, next) => saveCustomerAddress(req, res).catch(next));

router.get('/me/driver/notifications', authMiddleware, (req, res, next) => listDriverNotifications(req, res).catch(next));
router.put('/me/driver/notifications/:id/read', authMiddleware, (req, res, next) => markDriverNotificationRead(req, res).catch(next));
router.get('/me/driver', authMiddleware, (req, res, next) => getDriverRegistration(req, res).catch(next));
router.put('/me/driver', authMiddleware, (req, res, next) => updateDriverRegistration(req, res).catch(next));
router.put('/me/driver/license-photo', authMiddleware, (req: AuthRequest, res, next) => {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  upload.single('image')(req, res, (error) => {
    if (error) return res.status(400).json({ error: 'Envie uma foto JPEG, PNG ou WebP de até 5 MB.' });
    return saveDriverLicensePhoto(req, res).catch(next);
  });
});
router.get('/me/driver/withdrawals', authMiddleware, (req, res, next) => getDriverWithdrawals(req, res).catch(next));
router.post('/me/driver/asaas-account', authMiddleware, (req, res, next) => createDriverAsaasAccount(req, res).catch(next));
router.get('/me/driver/delivery-rate', authMiddleware, (req, res, next) => readMyDeliveryRate(req, res).catch(next));
router.put('/me/driver/delivery-rate', authMiddleware, (req, res, next) => updateMyDeliveryRate(req, res).catch(next));
router.get('/me/driver/dispatch', authMiddleware, (req, res, next) => readDriverDispatch(req, res).catch(next));
router.put('/me/driver/presence', authMiddleware, (req, res, next) => updateDriverPresence(req, res).catch(next));
router.post('/me/driver/shifts', authMiddleware, (req, res, next) => changeDriverShift(req, res).catch(next));
router.delete('/me/driver/shifts/:id', authMiddleware, (req, res, next) => changeDriverShift(req, res).catch(next));
router.post('/me/driver/weekly-shifts', authMiddleware, (req, res, next) => changeDriverWeeklyShift(req, res).catch(next));
router.delete('/me/driver/weekly-shifts/:id', authMiddleware, (req, res, next) => changeDriverWeeklyShift(req, res).catch(next));

export default router;
