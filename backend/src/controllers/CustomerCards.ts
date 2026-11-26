import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { addSavedCard, AsaasCardError, getAsaasCardConfig, listSavedCards, removeSavedCard } from '../services/AsaasSavedCards';

export async function customerCards(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const enabled = Boolean(getAsaasCardConfig());
      return res.json({ enabled, cards: enabled ? await listSavedCards(req.userId) : [] });
    }
    if (req.method === 'DELETE') {
      return res.sendStatus(await removeSavedCard(req.userId, req.params.id) ? 204 : 404);
    }
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Confirme que deseja guardar o cartão de teste.' });
    return res.status(201).json(await addSavedCard(req.userId, req.body ?? {}, req.ip));
  } catch (error) {
    if (error instanceof AsaasCardError && error.status < 500) {
      return res.status(error.status).json({ error: error.message.startsWith('Asaas HTTP')
        ? 'O Asaas não aceitou o cartão de teste ou os dados do titular.' : error.message });
    }
    return res.status(503).json({ error: 'Não foi possível gerenciar os cartões no Sandbox. Tente novamente.' });
  }
}
