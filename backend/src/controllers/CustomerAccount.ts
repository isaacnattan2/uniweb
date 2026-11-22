import bcrypt from 'bcryptjs';
import { NextFunction, Response } from 'express';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { normalizeDeliveryAddress } from '../services/DeliveryAddress';
import { UploadService } from '../services/UploadService';

export function requireCustomer(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userType !== 'customer' || !req.userId) {
    return res.status(403).json({ error: 'Acesso exclusivo para clientes.' });
  }
  res.set('Cache-Control', 'no-store');
  next();
}

export async function getCustomerProfile(req: AuthRequest, res: Response) {
  const result = await query(
    'SELECT full_name, email, phone, avatar_url FROM users WHERE id = $1', [req.userId]
  );
  if (!result.rows.length) return res.sendStatus(404);
  return res.json(result.rows[0]);
}

export async function updateCustomerProfile(req: AuthRequest, res: Response) {
  const { fullName, email, phone, currentPassword } = req.body || {};
  const name = typeof fullName === 'string' ? fullName.trim() : '';
  const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!name || name.length > 255 || address.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ||
      typeof phone !== 'string' || phone.trim().length > 20) {
    return res.status(400).json({ error: 'Confira nome, e-mail e telefone.' });
  }
  const result = await query('SELECT email, password_hash FROM users WHERE id = $1 AND status = $2', [req.userId, 'active']);
  const current = result.rows[0];
  if (!current) return res.sendStatus(404);

  if (address !== current.email.toLowerCase() &&
      (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024 ||
        !await bcrypt.compare(currentPassword, current.password_hash))) {
    return res.status(400).json({ error: 'Informe sua senha atual para alterar o e-mail de acesso.' });
  }
  try {
    const updated = await query(
      `UPDATE users SET full_name = $2, email = $3, phone = $4, updated_at = NOW()
       WHERE id = $1 AND email = $5 AND password_hash = $6 AND status = 'active'
       RETURNING full_name, email, phone, avatar_url`,
      [req.userId, name, address, phone.trim() || null, current.email, current.password_hash]
    );
    if (!updated.rows.length) return res.status(409).json({ error: 'Os dados da conta mudaram. Atualize a página e tente novamente.' });
    return res.json(updated.rows[0]);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'Este e-mail já está em uso.' });
    }
    throw error;
  }
}

export async function uploadCustomerAvatar(req: AuthRequest, res: Response) {
  if (!req.file) return res.status(400).json({ error: 'Selecione uma foto de perfil.' });
  let avatar: string;
  try {
    [avatar] = await UploadService.uploadImages([req.file], 'avatars');
  } catch (error) {
    console.error('Falha ao enviar foto de perfil:', error);
    return res.status(503).json({ error: 'Não foi possível enviar a foto. Tente novamente.' });
  }
  const result = await query(
    "UPDATE users SET avatar_url = $2, updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING avatar_url",
    [req.userId, avatar]
  );
  if (!result.rows.length) return res.sendStatus(404);
  return res.json(result.rows[0]);
}

export async function listCustomerAddresses(req: AuthRequest, res: Response) {
  const result = await query('SELECT id, address FROM customer_addresses WHERE user_id = $1 ORDER BY id', [req.userId]);
  return res.json(result.rows);
}

export async function saveCustomerAddress(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const address = normalizeDeliveryAddress(req.body);
  if (!address || (id && (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n))) {
    return res.status(400).json({ error: 'Confira os dados do endereço.' });
  }
  const args = [req.userId, JSON.stringify(address)];
  try {
    const result = id ? await query(
      `UPDATE customer_addresses SET address = $2::jsonb WHERE user_id = $1 AND id = $3
       RETURNING id, address`,
      [...args, id]
    ) : await query(
      `INSERT INTO customer_addresses (user_id, address) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id, address) DO NOTHING RETURNING id, address`,
      args
    );
    if (!result.rows.length) {
      return id ? res.status(404).json({ error: 'Endereço não encontrado na sua conta.' }) :
        res.status(409).json({ error: 'Este endereço já está salvo na sua conta.' });
    }
    return res.status(id ? 200 : 201).json(result.rows[0]);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'Este endereço já está salvo na sua conta.' });
    }
    throw error;
  }
}
