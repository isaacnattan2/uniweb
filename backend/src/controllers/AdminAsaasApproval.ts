import { Request, Response } from 'express';
import { query } from '../config/database';
import { AsaasStoreError, asaasStoreRequest, storeSandboxApi } from '../services/AsaasStoreAccounts';
import { readStoreAsaasApproval, resolveDriverAsaasAccount, resolveStoreAsaasAccount } from '../services/AsaasStoreApproval';

export function adminAsaasApproval(req: Request, res: Response) {
  return asaasApproval(req, res, 'business');
}

export function adminDriverAsaasApproval(req: Request, res: Response) {
  return asaasApproval(req, res, 'driver');
}

async function asaasApproval(req: Request, res: Response, role: 'business' | 'driver') {
  res.set('Cache-Control', 'no-store');
  const id = req.params.id.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return res.status(400).json({ error: 'Identificador inválido.' });
  }

  try {
    const { rows: [holder] } = await query(role === 'driver'
      ? 'SELECT user_id AS owner_id FROM drivers WHERE user_id = $1 AND deleted_at IS NULL'
      : 'SELECT owner_id FROM businesses WHERE id = $1', [id]);
    if (!holder) return res.status(404).json({ error: 'Cadastro não encontrado.' });
    const account = role === 'driver' ? await resolveDriverAsaasAccount(id) : await resolveStoreAsaasAccount(id, holder.owner_id);
    const sandbox = account.base === storeSandboxApi;
    if (req.method === 'POST' && (!sandbox || !account.canSimulate || !account.key)) {
      return res.status(403).json({ error: 'A simulação só está disponível para subcontas criadas pelo Uniweb no Sandbox.' });
    }
    if (!account.key) return res.json({ sandbox, registrationPending: account.registrationPending });

    if (req.method === 'POST') {
      const current = await asaasStoreRequest<{ general: string }>(storeSandboxApi, '/myAccount/status/', account.key);
      if (current.general !== 'APPROVED') {
        await asaasStoreRequest<unknown>(storeSandboxApi, '/sandbox/myAccount/approve', account.key, {});
      }
    }
    const approval = await readStoreAsaasApproval(account.base, account.key, 'admin', account.createdAt);
    return res.json({ sandbox, approval, canSimulate: Boolean(account.canSimulate && sandbox && approval.general !== 'APPROVED') });
  } catch (error) {
    const detail = error instanceof AsaasStoreError ? ' (HTTP ' + error.status + ')' : '';
    return res.status(502).json({ error: 'Não foi possível concluir a operação no Asaas' + detail + '.' });
  }
}