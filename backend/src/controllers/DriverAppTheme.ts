import { Request, Response } from 'express';
import { query } from '../config/database';

const defaultTheme = { primary: '#1762d1', secondary: '#152844' };
const color = /^#[0-9a-f]{6}$/i;

export async function getDriverAppTheme(_req: Request, res: Response) {
  const { rows } = await query('SELECT primary_color AS primary, secondary_color AS secondary FROM driver_app_theme WHERE id = true');
  res.set('Cache-Control', 'no-store');
  return res.json(rows[0] ?? defaultTheme);
}

export async function updateDriverAppTheme(req: Request, res: Response) {
  const { primary, secondary } = req.body ?? {};
  if (typeof primary !== 'string' || typeof secondary !== 'string' || !color.test(primary) || !color.test(secondary)) {
    return res.status(400).json({ error: 'Informe as duas cores no formato #RRGGBB.' });
  }
  const { rows } = await query(
    `INSERT INTO driver_app_theme (id, primary_color, secondary_color) VALUES (true, $1, $2)
     ON CONFLICT (id) DO UPDATE SET primary_color = EXCLUDED.primary_color, secondary_color = EXCLUDED.secondary_color
     RETURNING primary_color AS primary, secondary_color AS secondary`,
    [primary.toLowerCase(), secondary.toLowerCase()],
  );
  return res.json(rows[0]);
}
