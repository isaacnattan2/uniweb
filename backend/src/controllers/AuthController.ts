import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import AuthService from '../services/AuthService';

export class AuthController {
  async register(req: AuthRequest, res: Response) {
    try {
      const { email, password, fullName, phone, userType } = req.body;
      
      if (!email || !password || !fullName) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (userType && userType !== 'customer') {
        return res.status(403).json({ error: 'Somente clientes podem se cadastrar nesta página' });
      }
      const { user, token } = await AuthService.register(email, password, fullName, phone || '', 'customer');
      res.status(201).json({ user, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async login(req: AuthRequest, res: Response) {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
      }

      const { user, token } = await AuthService.login(email, password);
      res.json({ user, token });
    } catch (error: any) {
      res.status(401).json({ error: error.message });
    }
  }
}

export default new AuthController();
