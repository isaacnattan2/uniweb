import { getAdminAsaasBalance } from '../controllers/AdminAsaasBalance';
import { applyCardSplit, applyPixSplit, removeSplitCondition, readSplitPayments, sendDriverSplitPayment } from '../controllers/AdminAsaasSplit';
import { getAdminAsaasFees } from '../controllers/AdminAsaasFees';
import { adminAsaasApproval, adminDriverAsaasApproval } from '../controllers/AdminAsaasApproval';
import { deleteAd, listAdminAds, saveAd } from '../controllers/MarketplaceAd';
import { Router } from 'express';
import { query } from '../config/database';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import AuthService from '../services/AuthService';
import { updateDriverAppTheme } from '../controllers/DriverAppTheme';
import { dispatchSettings, listDispatchIncidents, resolveDispatchIncident } from '../controllers/DeliveryDispatch';
import { readDeliveryRatePolicy, updateDeliveryRatePolicy } from '../controllers/DriverDeliveryRates';
import { notifyAdminDriverPresence } from '../services/OrderPush';

const router = Router();
router.use(authMiddleware, requireAdmin);
router.put('/businesses/:id/pix-split', (req, res, next) => applyPixSplit(req, res).catch(next));
router.put('/businesses/:id/card-split', (req, res, next) => applyCardSplit(req, res).catch(next));
router.delete('/businesses/:id/split-conditions/:method/:version', (req, res, next) => removeSplitCondition(req, res).catch(next));
router.get('/asaas/split-payments', (req, res, next) => readSplitPayments(req, res).catch(next));
router.post('/asaas/split-payments/:id/driver', (req, res, next) => sendDriverSplitPayment(req, res).catch(next));
router.get('/asaas/balance', (req, res, next) => getAdminAsaasBalance(req, res).catch(next));
router.get('/asaas/fees', (req, res, next) => getAdminAsaasFees(req, res).catch(next));
router.get('/businesses/:id/asaas-account', (req, res, next) => adminAsaasApproval(req, res).catch(next));
router.post('/businesses/:id/asaas-account/sandbox-approve', (req, res, next) => adminAsaasApproval(req, res).catch(next));
router.get('/delivery-dispatch/settings', (req, res, next) => dispatchSettings(req, res).catch(next));
router.put('/delivery-dispatch/settings', (req, res, next) => dispatchSettings(req, res).catch(next));
router.get('/delivery-dispatch/incidents', (req, res, next) => listDispatchIncidents(req, res).catch(next));
router.put('/delivery-dispatch/incidents/:orderId', (req, res, next) => resolveDispatchIncident(req, res).catch(next));
router.put('/app/theme', (req, res, next) => updateDriverAppTheme(req, res).catch(next));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/drivers/:id/dispatch-audit', async (req, res, next) => {
  const { id } = req.params;
  if (!uuid.test(id)) return res.sendStatus(400);
  try {
    const { rows } = await query(
      `SELECT a.id, a.order_id, a.search_cycle, a.created_at,
              a.details - 'drivers' - 'selectedDriverId' ||
                jsonb_build_object('selected', a.details->>'selectedDriverId' = $1::text,
                  'decision', (SELECT d FROM jsonb_array_elements(a.details->'drivers') d
                               WHERE d->>'driverId' = $1::text LIMIT 1)) AS details
       FROM delivery_dispatch_audit a
       WHERE a.driver_ids @> ARRAY[$1::uuid]
          OR (a.details->>'event' = 'dispatch_search_expired' AND EXISTS (
            SELECT 1 FROM delivery_dispatch_audit related
            WHERE related.order_id = a.order_id AND related.search_cycle = a.search_cycle
              AND related.driver_ids @> ARRAY[$1::uuid]
          ))
       ORDER BY a.created_at DESC, a.id DESC LIMIT 50`, [id.toLowerCase()],
    );
    res.set('Cache-Control', 'no-store');
    return res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/drivers/:id/asaas-account', (req, res, next) => adminDriverAsaasApproval(req, res).catch(next));
router.post('/drivers/:id/asaas-account/sandbox-approve', (req, res, next) => adminDriverAsaasApproval(req, res).catch(next));
router.get('/drivers/delivery-rate', (req, res, next) => readDeliveryRatePolicy(req, res).catch(next));
router.put('/drivers/delivery-rate', (req, res, next) => updateDeliveryRatePolicy(req, res).catch(next));

router.get('/drivers', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.status, d.vehicle_type,
              d.vehicle_manufacturer, d.vehicle_brand, d.vehicle_color, d.vehicle_plate,
              d.delivery_rate_cents, d.delivery_rate_locked, d.missed_offer_block_minutes,
              (u.status = 'active' AND d.user_id IS NOT NULL AND COALESCE(p.online, false)) AS checked_in
       FROM users u
       LEFT JOIN drivers d ON d.user_id = u.id AND d.deleted_at IS NULL
       LEFT JOIN driver_dispatch_presence p ON p.user_id = u.id
       WHERE u.user_type = 'driver' AND u.status <> 'deleted'
       ORDER BY u.full_name, u.id`
    );
    res.set('Cache-Control', 'no-store');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.put('/drivers/:id/missed-offer-block', async (req, res, next) => {
  const { id } = req.params;
  const { minutes } = req.body ?? {};
  if (!uuid.test(id) || (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080))) {
    return res.status(400).json({ error: 'Informe um bloqueio entre 1 e 10080 minutos ou use o tempo global.' });
  }
  try {
    const { rows } = await query(
      `UPDATE drivers d SET missed_offer_block_minutes = $2, updated_at = NOW()
       FROM users u WHERE u.id = $1 AND u.id = d.user_id AND u.user_type = 'driver'
         AND u.status <> 'deleted' AND d.deleted_at IS NULL
       RETURNING d.missed_offer_block_minutes AS minutes`, [id, minutes],
    );
    if (!rows.length) return res.status(404).json({ error: 'Cadastro de entregador não encontrado.' });
    return res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/drivers/:id/delivery-rate-lock', async (req, res, next) => {
  const { id } = req.params;
  const { locked } = req.body ?? {};
  if (!uuid.test(id) || typeof locked !== 'boolean') {
    return res.status(400).json({ error: 'Entregador ou bloqueio de taxa inválido.' });
  }
  try {
    const { rows } = await query(
      `UPDATE drivers d SET delivery_rate_locked = $2, updated_at = NOW()
       FROM users u WHERE u.id = $1 AND u.id = d.user_id AND u.user_type = 'driver'
         AND u.status <> 'deleted' AND d.deleted_at IS NULL
       RETURNING d.delivery_rate_locked AS locked`,
      [id, locked]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cadastro de entregador não encontrado.' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/drivers/:id/status', async (req, res, next) => {
  const { id } = req.params;
  const { blocked } = req.body ?? {};
  if (!uuid.test(id) || typeof blocked !== 'boolean') {
    return res.status(400).json({ error: 'Entregador ou bloqueio inválido.' });
  }
  try {
    const { rows } = await query(
      `UPDATE users SET status = $2, updated_at = NOW()
       WHERE id = $1 AND user_type = 'driver' AND status IN ('active', 'suspended')
       RETURNING id, status`,
      [id, blocked ? 'suspended' : 'active']
    );
    if (!rows.length) return res.status(404).json({ error: 'Entregador indisponível para alteração de acesso.' });
    notifyAdminDriverPresence();
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/categories', async (req, res, next) => {
  const { kind, label } = req.body || {};
  const name = typeof label === 'string' ? label.trim().replace(/\s+/g, ' ') : '';
  const value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if ((kind !== 'business' && kind !== 'product') || !value || name.length > 100) {
    return res.status(400).json({ error: 'Informe um nome válido para a categoria.' });
  }
  try {
    const result = await query(
      `INSERT INTO marketplace_categories (kind, value, label) VALUES ($1, $2, $3)
       ON CONFLICT (kind, value) DO NOTHING RETURNING kind, value, label`,
      [kind, value, name]
    );
    if (!result.rows.length) return res.status(409).json({ error: 'Esta categoria já está cadastrada.' });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

function categorySource(kind: string) {
  if (kind === 'business') return 'businesses';
  if (kind === 'product') return 'products';
  return null;
}

router.put('/categories/:kind/:value', async (req, res, next) => {
  const { kind, value } = req.params;
  const source = categorySource(kind);
  const input = req.body?.label;
  const label = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!source || !value.trim() || value.length > 100 || !label || label.length > 100) {
    return res.status(400).json({ error: 'Informe uma categoria válida e um nome de até 100 caracteres.' });
  }
  try {
    const result = await query(
      `INSERT INTO marketplace_categories (kind, value, label)
       SELECT $1, $2, $3 WHERE EXISTS (
         SELECT FROM marketplace_categories WHERE kind = $1 AND value = $2
         UNION ALL
         SELECT FROM ${source} WHERE LOWER(TRIM(category)) = $2 AND deleted_at IS NULL
       )
       ON CONFLICT (kind, value) DO UPDATE SET label = EXCLUDED.label
       RETURNING kind, value, label`,
      [kind, value, label]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/categories/:kind/:value', async (req, res, next) => {
  const { kind, value } = req.params;
  const source = categorySource(kind);
  if (!source || !value.trim() || value.length > 100) {
    return res.status(400).json({ error: 'Categoria inválida.' });
  }
  try {
    const result = await query(
      `WITH usage AS (
         SELECT EXISTS (SELECT FROM ${source} WHERE LOWER(TRIM(category)) = $2 AND deleted_at IS NULL) AS in_use
       ), removed AS (
         DELETE FROM marketplace_categories WHERE kind = $1 AND value = $2 AND NOT (SELECT in_use FROM usage)
         RETURNING value
       )
       SELECT usage.in_use, EXISTS (SELECT FROM removed) AS deleted FROM usage`,
      [kind, value]
    );
    const { in_use, deleted } = result.rows[0];
    if (in_use) return res.status(409).json({ error: 'Esta categoria está em uso. Altere a categoria das lojas ou produtos vinculados antes de excluir.' });
    if (!deleted) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

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

router.put('/businesses/:id/platform-fee', async (req, res, next) => {
  const { id } = req.params;
  const { platform_fee_basis_points: fee } = req.body || {};
  if (!uuid.test(id) || (fee !== null &&
      (typeof fee !== 'number' || !Number.isInteger(fee) || fee < 0 || fee > 10000))) {
    return res.status(400).json({ error: 'Informe uma taxa entre 0% e 100%, com até duas casas decimais.' });
  }

  try {
    const { rows: [business] } = await query(
      `UPDATE businesses SET platform_fee_basis_points = $2, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL RETURNING platform_fee_basis_points`,
      [id, fee],
    );
    if (!business) return res.status(404).json({ error: 'Loja não encontrada.' });
    return res.json(business);
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

router.get('/ads', (req, res, next) => listAdminAds(req, res).catch(next));
router.post('/ads', (req, res, next) => saveAd(req, res).catch(next));
router.put('/ads/:id', (req, res, next) => saveAd(req, res).catch(next));
router.delete('/ads/:id', (req, res, next) => deleteAd(req, res).catch(next));

export default router;
