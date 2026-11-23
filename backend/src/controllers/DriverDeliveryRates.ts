import { Request, Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getDeliveryRatePolicy, getDriverDeliveryRate, saveDeliveryRatePolicy, validRate } from '../services/DriverDeliveryRates';

export async function readDeliveryRatePolicy(_req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  return res.json(await getDeliveryRatePolicy());
}

export async function updateDeliveryRatePolicy(req: Request, res: Response) {
  const { minimumCents = null, maximumCents = null, defaultCents, allowCustom } = req.body ?? {};
  if (!validRate(defaultCents) || (minimumCents !== null && !validRate(minimumCents)) ||
      (maximumCents !== null && !validRate(maximumCents)) ||
      (minimumCents !== null && maximumCents !== null && minimumCents > maximumCents) ||
      typeof allowCustom !== 'boolean') {
    return res.status(400).json({ error: 'Informe a taxa padrão em R$/km. Se preencher os dois limites, o mínimo deve ser menor ou igual ao máximo.' });
  }
  return res.json(await saveDeliveryRatePolicy({ minimumCents, maximumCents, defaultCents, allowCustom }));
}

export async function readMyDeliveryRate(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  return res.json(await getDriverDeliveryRate(req.userId));
}

export async function updateMyDeliveryRate(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  const { rateCents } = req.body ?? {};
  if (!validRate(rateCents)) return res.status(400).json({ error: 'Informe uma taxa válida em R$/km.' });
  const { rowCount } = await query(
    `WITH policy AS (
       SELECT minimum_cents, maximum_cents FROM driver_delivery_rate_policy
       WHERE id = true AND allow_custom FOR SHARE
     )
     UPDATE drivers d SET delivery_rate_cents = $2, updated_at = NOW()
     FROM policy p
     WHERE d.user_id = $1 AND d.deleted_at IS NULL AND NOT d.delivery_rate_locked
       AND (p.minimum_cents IS NULL OR $2 >= p.minimum_cents)
       AND (p.maximum_cents IS NULL OR $2 <= p.maximum_cents)`,
    [req.userId, rateCents]
  );
  const rate = await getDriverDeliveryRate(req.userId);
  if (!rowCount) {
    return res.status(409).json({
      error: rate.canEdit ? 'A taxa precisa respeitar os limites definidos pela administração.' : 'A edição da taxa está desabilitada.',
      rate,
    });
  }
  return res.json(rate);
}
