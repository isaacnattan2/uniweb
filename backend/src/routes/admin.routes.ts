import { Router } from 'express';
import { query } from '../config/database';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import AuthService from '../services/AuthService';

const router = Router();
router.use(authMiddleware, requireAdmin);

router.get('/sellers', async (_req, res, next) => {
  try {
    const result = await query(
      "SELECT id, full_name, email FROM users WHERE user_type = 'business' AND status = 'active' ORDER BY full_name"
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/sellers', async (req, res, next) => {
  const { fullName, email, password } = req.body;
  if (typeof fullName !== 'string' || !fullName.trim() ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres' });
  }
  try {
    const { user } = await AuthService.register(email.trim().toLowerCase(), password, fullName.trim(), '', 'business');
    res.status(201).json(user);
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'Já existe uma conta com este e-mail' });
    }
    next(error);
  }
});

router.get('/businesses', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT b.*, u.full_name AS owner_name, u.email AS owner_email
       FROM businesses b JOIN users u ON u.id = b.owner_id ORDER BY b.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.put('/businesses/:businessId/owner', async (req, res, next) => {
  const { businessId } = req.params;
  const { ownerId } = req.body;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(businessId) || typeof ownerId !== 'string' || !uuid.test(ownerId)) {
    return res.status(400).json({ error: 'Loja ou lojista inválido' });
  }
  try {
    const owner = await query("SELECT id FROM users WHERE id = $1 AND user_type = 'business' AND status = 'active'", [ownerId]);
    if (!owner.rows.length) return res.status(400).json({ error: 'Lojista não encontrado ou inativo' });
    const result = await query(
      'UPDATE businesses SET owner_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [ownerId, businessId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Loja não encontrada' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

export default router;
