import { validateNewPassword } from '../services/PasswordPolicy';
import bcrypt from 'bcryptjs';
import { Response } from 'express';
import { v4 as uuid } from 'uuid';
import { query } from '../config/database';
import { generateToken } from '../config/jwt';
import { AuthRequest } from '../middleware/auth';

const vehicleTypes = ['bicycle', 'motorcycle', 'car', 'utility', 'van', 'truck'];

function driverProfile(input: Record<string, unknown>) {
  const text = (field: string) => typeof input[field] === 'string' ? input[field].trim() : '';
  return {
    fullName: text('fullName'), email: text('email').toLowerCase(),
    phone: text('phone').replace(/[()\s-]/g, '').replace(/^\+55/, ''),
    type: text('vehicleType'), manufacturer: text('manufacturer'), brand: text('brand'), color: text('color'),
    plate: text('plate').toUpperCase().replace(/[\s-]/g, ''),
  };
}

function validContact({ fullName, email, phone }: ReturnType<typeof driverProfile>) {
  return !!fullName && fullName.length <= 255 && email.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && /^[0-9]{10,11}$/.test(phone);
}

function vehicleError({ type, manufacturer, brand, color, plate }: ReturnType<typeof driverProfile>) {
  if (!vehicleTypes.includes(type) || !manufacturer || manufacturer.length > 100 ||
      !brand || brand.length > 100 || !color || color.length > 50) {
    return 'Selecione o veículo e informe fabricante, marca e cor.';
  }
  if ((type !== 'bicycle' || plate) && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) {
    return 'Informe uma placa válida, como ABC1234 ou ABC1D23.';
  }
}

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
  const profile = driverProfile(input);
  const { fullName, email, phone, type, manufacturer, brand, color, plate } = profile;
  const password = typeof input.password === 'string' ? input.password : '';
  const cpf = text('cpf').replace(/[.\-]/g, '');

  if (!validContact(profile)) {
    return res.status(400).json({ error: 'Informe nome, e-mail e telefone com DDD válidos.' });
  }
  const passwordError = validateNewPassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  if (!isValidCpf(cpf)) return res.status(400).json({ error: 'Informe um CPF válido.' });
  const error = vehicleError(profile);
  if (error) return res.status(400).json({ error });

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

function driverAppDownloadUrl() {
  const configuredUrl = process.env.DRIVER_APP_DOWNLOAD_URL?.trim();
  if (!configuredUrl) return;

  try {
    const url = new URL(configuredUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {
    return;
  }
}

export async function getDriverRegistration(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  const result = await query(
    `SELECT u.full_name, u.email, u.phone, d.vehicle_type, d.vehicle_manufacturer, d.vehicle_brand, d.vehicle_color, d.vehicle_plate,
      (SELECT uploaded_at FROM driver_license_photos WHERE driver_user_id = u.id) AS license_photo_uploaded_at
     FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.id = $1 AND d.deleted_at IS NULL`,
    [req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Cadastro de entregador não encontrado.' });
  return res.json({ ...result.rows[0], app_download_url: driverAppDownloadUrl() });
}

export async function updateDriverRegistration(req: AuthRequest, res: Response) {
  if (req.userType !== 'driver' || !req.userId) return res.sendStatus(403);
  res.set('Cache-Control', 'no-store');
  const profile = driverProfile(req.body || {});
  if (!validContact(profile)) {
    return res.status(400).json({ error: 'Informe nome, e-mail e telefone com DDD válidos.' });
  }
  const error = vehicleError(profile);
  if (error) return res.status(400).json({ error });
  const { fullName, email, phone, type, manufacturer, brand, color, plate } = profile;
  try {
    const { rows: [updated] } = await query(
      `WITH vehicle AS (
         UPDATE drivers SET vehicle_type = $5, vehicle_manufacturer = $6, vehicle_brand = $7,
           vehicle_color = $8, vehicle_plate = $9, updated_at = NOW()
         WHERE user_id = $1 AND deleted_at IS NULL
         RETURNING user_id, vehicle_type, vehicle_manufacturer, vehicle_brand, vehicle_color, vehicle_plate
       )
       UPDATE users u SET full_name = $2, email = $3, phone = $4, updated_at = NOW()
       FROM vehicle v WHERE u.id = v.user_id
       RETURNING u.full_name, u.email, u.phone, v.vehicle_type, v.vehicle_manufacturer,
         v.vehicle_brand, v.vehicle_color, v.vehicle_plate,
         (SELECT uploaded_at FROM driver_license_photos WHERE driver_user_id = u.id) AS license_photo_uploaded_at`,
      [req.userId, fullName, email, phone, type, manufacturer, brand, color, plate || null]
    );
    if (!updated) return res.status(404).json({ error: 'Cadastro de entregador não encontrado.' });
    return res.json(updated);
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      return res.status(409).json({ error: 'Já existe um cadastro com este e-mail ou placa.' });
    }
    throw err;
  }
}
