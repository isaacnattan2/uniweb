import { Router } from 'express';
import { query } from '../config/database';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import AuthService from '../services/AuthService';

const router = Router();
router.use(authMiddleware, requireAdmin);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/sellers', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, full_name, email, phone, status FROM users
       WHERE user_type = 'business' AND status <> 'deleted' AND (status = 'active' OR $1::boolean)
       ORDER BY full_name`,
      [req.query.includeInactive === 'true']
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

router.put('/sellers/:id', async (req, res, next) => {
  const { id } = req.params;
  const { fullName, email, phone } = req.body || {};
  if (!uuid.test(id) || typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 255 ||
      typeof email !== 'string' || email.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof phone !== 'string' || phone.trim().length > 20) {
    return res.status(400).json({ error: 'Informe nome, e-mail e telefone válidos.' });
  }
  try {
    const result = await query(
      `UPDATE users SET full_name = $2, email = $3, phone = $4, updated_at = NOW()
       WHERE id = $1 AND user_type = 'business' AND status <> 'deleted'
       RETURNING id, full_name, email, phone, status`,
      [id, fullName.trim(), email.trim().toLowerCase(), phone.trim() || null]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Lojista não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
    }
    next(error);
  }
});

router.put('/sellers/:id/status', async (req, res, next) => {
  const { id } = req.params;
  const { blocked } = req.body || {};
  if (!uuid.test(id) || typeof blocked !== 'boolean') {
    return res.status(400).json({ error: 'Lojista ou bloqueio inválido.' });
  }
  try {
    const result = await query(
      `UPDATE users SET status = $2, updated_at = NOW()
       WHERE id = $1 AND user_type = 'business' AND status <> 'deleted'
       RETURNING id, status`,
      [id, blocked ? 'suspended' : 'active']
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Lojista não encontrado.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/businesses/:id/status', async (req, res, next) => {
  const { id } = req.params;
  const { blocked } = req.body || {};
  if (!uuid.test(id) || typeof blocked !== 'boolean') {
    return res.status(400).json({ error: 'Loja ou bloqueio inválido.' });
  }
  try {
    const result = await query(
      'UPDATE businesses SET status = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, status',
      [id, blocked ? 'suspended' : 'active']
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Loja não encontrada.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/businesses', async (_req, res, next) => {
  try {
    const result = await query(
      `SELECT b.*, u.full_name AS owner_name, u.email AS owner_email, u.status AS owner_status
       FROM businesses b JOIN users u ON u.id = b.owner_id WHERE b.deleted_at IS NULL ORDER BY b.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.put('/businesses/:businessId/owner', async (req, res, next) => {
  const { businessId } = req.params;
  const { ownerId } = req.body;
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
