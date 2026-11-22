import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import BusinessService, { BusinessUpdate } from '../services/BusinessService';
import { MAX_CARD_INSTALLMENTS } from '../services/AsaasCheckout';
import { query } from '../config/database';

export class BusinessController {
  async createBusiness(req: AuthRequest, res: Response) {
    try {
      const { name, description, category, ownerId } = req.body;
      
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (!name || !ownerId || typeof ownerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
        return res.status(400).json({ error: 'Informe o nome e um lojista válido' });
      }
      const owner = await query("SELECT id FROM users WHERE id = $1 AND user_type = 'business' AND status = 'active'", [ownerId]);
      if (!owner.rows.length) return res.status(400).json({ error: 'Lojista não encontrado ou inativo' });
      const business = await BusinessService.createBusiness(ownerId, name, description, category);
      res.status(201).json(business);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getMyBusinesses(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const businesses = await BusinessService.getBusinessesByOwner(req.userId);
      res.json(businesses);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getBusiness(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const business = await BusinessService.getBusinessById(id);
      
      if (!business) {
        return res.status(404).json({ error: 'Business not found' });
      }

      res.json(business);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async updateBusiness(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      if (!req.userId || (req.userType !== 'admin' && req.userType !== 'business')) {
        return res.status(403).json({ error: 'Sem acesso a esta loja' });
      }
      const allowed = ['name', 'description', 'category', 'address', 'payment_methods', 'max_card_installments'];
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Campos de loja inválidos' });
      }
      const keys = Object.keys(req.body);
      if (!keys.length || keys.some((key) => !allowed.includes(key))) {
        return res.status(400).json({ error: 'Campos de loja inválidos' });
      }
      const data: BusinessUpdate = {};
      if ('name' in req.body) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 255) {
          return res.status(400).json({ error: 'Informe um nome válido de até 255 caracteres' });
        }
        data.name = req.body.name.trim();
      }
      if ('category' in req.body) {
        if (req.body.category !== null && (typeof req.body.category !== 'string' || !req.body.category.trim() || req.body.category.trim().length > 100)) {
          return res.status(400).json({ error: 'Informe uma categoria válida de até 100 caracteres' });
        }
        data.category = typeof req.body.category === 'string' ? req.body.category.trim() : null;
      }
      if ('description' in req.body) {
        if (req.body.description !== null && typeof req.body.description !== 'string') {
          return res.status(400).json({ error: 'Descrição inválida' });
        }
        data.description = typeof req.body.description === 'string' ? req.body.description.trim() : null;
      }
      if ('address' in req.body) {
        const address = req.body.address;
        if (address !== null && (typeof address !== 'string' || address.trim().length > 300)) {
          return res.status(400).json({ error: 'O endereço da loja deve ter até 300 caracteres.' });
        }
        data.address = address?.trim() || null;
      }
      if ('payment_methods' in req.body) {
        const methods = req.body.payment_methods;
        if (!Array.isArray(methods) || methods.length < 1 || methods.length > 2 ||
            new Set(methods).size !== methods.length ||
            !methods.every((method) => method === 'pix' || method === 'credit_card')) {
          return res.status(400).json({ error: 'Selecione pelo menos uma forma de pagamento disponível.' });
        }
        data.payment_methods = methods;
      }
      if ('max_card_installments' in req.body) {
        const count = req.body.max_card_installments;
        if (!Number.isInteger(count) || count < 1 || count > MAX_CARD_INSTALLMENTS) {
          return res.status(400).json({ error: 'Escolha um limite de 1 a 12 parcelas.' });
        }
        data.max_card_installments = count;
      }
      const business = await BusinessService.updateBusiness(id, data, req.userType === 'admin' ? undefined : req.userId);
      if (!business) {
        return res.status(req.userType === 'admin' ? 404 : 403).json({ error: 'Sem acesso a esta loja ou loja não encontrada' });
      }
      res.json(business);
    } catch (error) {
      console.error('Erro ao atualizar loja:', error);
      res.status(500).json({ error: 'Não foi possível atualizar a loja' });
    }
  }
}

export default new BusinessController();
