import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../config/jwt';
import { query } from '../config/database';

export interface AuthRequest extends Request {
  userId?: string;
  userType?: 'admin' | 'business' | 'customer' | 'driver';
  businessId?: string;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  let userId: string;
  try {
    const decoded = verifyToken(token);
    if (typeof decoded.id !== 'string') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    userId = decoded.id;
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const result = await query(
      "SELECT id, user_type FROM users WHERE id = $1 AND status = 'active'",
      [userId]
    );
    if (!result.rows[0]) {
      return res.status(401).json({ error: 'Usuário inativo ou não encontrado' });
    }
    req.userId = result.rows[0].id;
    req.userType = result.rows[0].user_type;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.userType !== 'admin') {
    return res.status(403).json({ error: 'Acesso exclusivo para administradores' });
  }
  next();
}

export async function requireBusinessAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const businessId = req.params.businessId || req.params.id || req.body?.businessId;
    if (typeof businessId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) {
      return res.status(400).json({ error: 'ID de loja inválido' });
    }
    const result = await query('SELECT owner_id FROM businesses WHERE id = $1', [businessId]);
    const business = result.rows[0];
    if (!business) return res.status(404).json({ error: 'Loja não encontrada' });
    if (req.userType !== 'admin' && (req.userType !== 'business' || business.owner_id !== req.userId)) {
      return res.status(403).json({ error: 'Sem acesso a esta loja' });
    }
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireProductAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(400).json({ error: 'ID de produto inválido' });
    }
    const result = await query(
      'SELECT b.owner_id FROM products p JOIN businesses b ON b.id = p.business_id WHERE p.id = $1',
      [req.params.id]
    );
    const product = result.rows[0];
    if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
    if (req.userType !== 'admin' && (req.userType !== 'business' || product.owner_id !== req.userId)) {
      return res.status(403).json({ error: 'Sem acesso a este produto' });
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
}
