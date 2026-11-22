import { Request, Response } from 'express';
import { query } from '../config/database';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function listPublishedAds(_req: Request, res: Response) {
  const result = await query(
    `SELECT a.id, a.business_id, a.title, a.image_url
     FROM marketplace_ads a
     JOIN businesses b ON b.id = a.business_id
     JOIN users u ON u.id = b.owner_id
     WHERE a.published AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
     ORDER BY a.position, a.created_at, a.id`
  );
  res.json(result.rows);
}

export async function listAdminAds(_req: Request, res: Response) {
  const result = await query('SELECT * FROM marketplace_ads ORDER BY position, created_at, id');
  res.json(result.rows);
}

export async function saveAd(req: Request, res: Response) {
  const { id } = req.params;
  const { businessId, title, position, published, imageUrl } = req.body || {};
  const label = typeof title === 'string' ? title.trim() : '';
  const source = typeof imageUrl === 'string' && imageUrl.length <= 2048 && URL.canParse(imageUrl) ? new URL(imageUrl) : null;
  if ((id && !uuid.test(id)) || typeof businessId !== 'string' || !uuid.test(businessId) ||
      !label || label.length > 150 || !source || source.protocol !== 'https:' || source.username || source.password ||
      !Number.isInteger(position) || position < 0 || position > 2147483647 || typeof published !== 'boolean') {
    return res.status(400).json({ error: 'Selecione uma loja, envie uma imagem e informe título e posição válidos.' });
  }
  const args = [businessId, label, source.href, position, published];
  const result = id
    ? await query(
        `UPDATE marketplace_ads SET business_id = $1, title = $2, image_url = $3, position = $4, published = $5
         WHERE id = $6 AND EXISTS (SELECT 1 FROM businesses WHERE id = $1 AND deleted_at IS NULL)
         RETURNING *`,
        [...args, id]
      )
    : await query(
        `INSERT INTO marketplace_ads (business_id, title, image_url, position, published)
         SELECT id, $2, $3, $4, $5 FROM businesses WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        args
      );
  if (!result.rows.length) return res.status(404).json({ error: 'Loja ou publicidade não encontrada.' });
  return res.status(id ? 200 : 201).json(result.rows[0]);
}

export async function deleteAd(req: Request, res: Response) {
  if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'Publicidade inválida.' });
  const result = await query('DELETE FROM marketplace_ads WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Publicidade não encontrada.' });
  return res.sendStatus(204);
}
