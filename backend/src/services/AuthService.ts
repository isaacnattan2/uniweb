import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import type { DeliveryAddress } from './DeliveryAddress';
import { generateToken } from '../config/jwt';

export class AuthService {
  async register(email: string, password: string, fullName: string, phone: string, userType: string, address?: DeliveryAddress) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    
    const insertUser = `INSERT INTO users (id, email, password_hash, full_name, phone, user_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, email, full_name, user_type`;
    const values = [userId, email, hashedPassword, fullName, phone, userType];
    const result = address ? await query(
      `WITH created AS (${insertUser}), saved AS (
        INSERT INTO customer_addresses (user_id, address) SELECT id, $7::jsonb FROM created
      ) SELECT * FROM created`, [...values, JSON.stringify(address)]
    ) : await query(insertUser, values);

    const user = result.rows[0];
    const token = generateToken({ id: user.id, email: user.email });
    
    return { user, token };
  }

  async login(email: string, password: string) {
    const result = await query("SELECT * FROM users WHERE email = $1 AND status = 'active'", [email]);
    
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }

    const user = result.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      throw new Error('Invalid password');
    }

    const token = generateToken({ id: user.id, email: user.email });
    return { user: { id: user.id, email: user.email, full_name: user.full_name, user_type: user.user_type }, token };
  }
}

export default new AuthService();
