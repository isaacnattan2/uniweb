import { Response } from 'express';
import { getClient } from '../config/database';
import { AuthRequest } from '../middleware/auth';

export async function rateMarketplaceItem(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) {
    return res.status(403).json({ error: 'Entre com uma conta de cliente para avaliar.' });
  }

  const { kind, id } = req.params;
  const { rating } = req.body || {};
  if ((kind !== 'business' && kind !== 'product') ||
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ||
      !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Escolha de uma a cinco estrelas.' });
  }

  const client = await getClient().catch(() => null);
  if (!client) return res.status(503).json({ error: 'Serviço de avaliações indisponível.' });
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    const business = kind === 'business';
    const target = await client.query(
      business
        ? `SELECT b.id FROM businesses b JOIN users u ON u.id = b.owner_id
           WHERE b.id = $1 AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
           FOR UPDATE OF b FOR SHARE OF u`
        : `SELECT p.id FROM products p JOIN businesses b ON b.id = p.business_id JOIN users u ON u.id = b.owner_id
           WHERE p.id = $1 AND p.status = 'active' AND p.deleted_at IS NULL
             AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
           FOR UPDATE OF p FOR SHARE OF b, u`,
      [id]
    );
    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item indisponível para avaliação.' });
    }

    const previous = await client.query(
      `SELECT id, status FROM reviews WHERE reviewed_entity_type = $1 AND reviewed_entity_id = $2
         AND user_id = $3 AND deleted_at IS NULL
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [kind, id, req.userId]
    );
    const review = previous.rows[0];
    if (review && review.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Sua avaliação está indisponível para edição.' });
    }
    if (review) {
      await client.query('UPDATE reviews SET rating = $1, updated_at = NOW() WHERE id = $2', [rating, review.id]);
    } else {
      await client.query(
        'INSERT INTO reviews (reviewed_entity_type, reviewed_entity_id, user_id, rating) VALUES ($1, $2, $3, $4)',
        [kind, id, req.userId, rating]
      );
    }
    const summary = await client.query(
      `WITH latest AS (
         SELECT DISTINCT ON (user_id) rating FROM reviews
         WHERE reviewed_entity_type = $1 AND reviewed_entity_id = $2 AND status = 'approved' AND deleted_at IS NULL
         ORDER BY user_id, updated_at DESC NULLS LAST, id DESC
       ), totals AS (
         SELECT ROUND(AVG(rating), 2) AS rating, COUNT(*)::int AS rating_count FROM latest
       )
       UPDATE ${business ? 'businesses' : 'products'} t
       SET rating = totals.rating, rating_count = totals.rating_count FROM totals
       WHERE t.id = $2 RETURNING t.rating, t.rating_count`,
      [kind, id]
    );
    await client.query('COMMIT');
    return res.json(summary.rows[0]);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      releaseError = new Error('Falha ao desfazer avaliação');
    }
    console.error('Falha ao salvar avaliação:', error);
    return res.status(500).json({ error: 'Não foi possível salvar sua avaliação.' });
  } finally {
    client.release(releaseError);
  }
}
