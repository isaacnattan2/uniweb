import bcrypt from 'bcryptjs';
import { Response } from 'express';
import { v4 as uuid } from 'uuid';
import { query } from '../config/database';
import { generateToken } from '../config/jwt';
import { AuthRequest } from '../middleware/auth';

const vehicleTypes = ['bicycle', 'motorcycle', 'car', 'utility', 'van', 'truck'];

export function isValidCpf(cpf: string): boolean {
  if (!/^[0-9]{11}$/.test(cpf) || new Set(cpf).size === 1) return false;
  const digits = [...cpf].map(Number);
  return [9, 10].every((length) => {
    const sum = digits.slice(0, length).reduce((total, digit, index) => total + digit * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return digits[length] === (remainder === 10 ? 0 : remainder);
  });
}

export async function registerDriver(req: AuthRequest, res: Response) {
  const input = req.body || {};
  const text = (field: string) => typeof input[field] === 'string' ? input[field].trim() as string : '';
  const fullName = text('fullName');
  const email = text('email').toLowerCase();
  const phone = text('phone').replace(/[()\s-]/g, '').replace(/^\+55/, '');
  const password = typeof input.password === 'string' ? input.password : '';
  const cpf = text('cpf').replace(/[.\-]/g, '');
  const type = text('vehicleType');
  const manufacturer = text('manufacturer');
  const brand = text('brand');
  const color = text('color');
  const plate = text('plate').toUpperCase().replace(/[\s-]/g, '');

  if (!fullName || fullName.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
      !/^[0-9]{10,11}$/.test(phone) || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Informe nome, e-mail, telefone com DDD e uma senha de pelo menos 8 caracteres.' });
  }
  if (!isValidCpf(cpf)) return res.status(400).json({ error: 'Informe um CPF válido.' });
  if (!vehicleTypes.includes(type) || !manufacturer || manufacturer.length > 100 ||
      !brand || brand.length > 100 || !color || color.length > 50) {
    return res.status(400).json({ error: 'Selecione o veículo e informe fabricante, marca e cor.' });
  }
  if ((type !== 'bicycle' || plate) && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
    return res.status(400).json({ error: 'Informe uma placa válida, como ABC1234 ou ABC1D23.' });
  }

  try {
    const id = uuid();
    const hashed = await bcrypt.hash(password, 10);
    const result = await query(
      `WITH account AS (
         INSERT INTO users (id, full_name, email, phone, password_hash, cpf_cnpj, user_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'driver', 'active')
         RETURNING id, email, full_name, user_type
       ), vehicle AS (
         INSERT INTO drivers (user_id, vehicle_type, vehicle_manufacturer, vehicle_brand, vehicle_color, vehicle_plate)
         SELECT id, $7, $8, $9, $10, $11 FROM account RETURNING user_id
       )
       SELECT account.* FROM account JOIN vehicle ON vehicle.user_id = account.id`,
      [id, fullName, email, phone, hashed, cpf, type, manufacturer, brand, color, plate || null]
    );
    const user = result.rows[0];
    return res.status(201).json({ user, token: generateToken({ id, email }) });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'Já existe uma conta com este e-mail ou CPF.' });
    }
    throw error;
  }
}

export async function getDriverRegistration(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  const result = await query(
    `SELECT u.full_name, u.email, u.phone, d.vehicle_type, d.vehicle_manufacturer, d.vehicle_brand, d.vehicle_color, d.vehicle_plate
     FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.id = $1 AND d.deleted_at IS NULL`,
    [req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Cadastro de entregador não encontrado.' });
  return res.json(result.rows[0]);
}
