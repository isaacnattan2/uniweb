import { NextFunction, Request, Response } from 'express';
import { getClient, query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

const validTarget = (kind: string, id: string) =>
  (kind === 'business' || kind === 'product') && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);

function paidPurchase(kind: string) {
  return `SELECT 1 FROM orders o
          WHERE o.user_id = $1 AND o.payment_status = 'paid'
            AND o.order_status <> 'cancelled' AND o.deleted_at IS NULL
            AND ${kind === 'business' ? 'o.business_id = $2' :
              'EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.product_id = $2)'}
          LIMIT 1`;
}

export async function getMarketplaceComments(req: Request, res: Response, next: NextFunction) {
  const { kind, id } = req.params;
  const page = req.query.page === undefined ? 0 : typeof req.query.page === 'string' ? Number(req.query.page) : NaN;
  if (!validTarget(kind, id) || !Number.isSafeInteger(page) || page < 0 || page > 100000) {
    return res.status(400).json({ error: 'Consulta de comentários inválida.' });
  }
  try {
    const result = await query(
      `WITH latest AS (
         SELECT DISTINCT ON (r.user_id) r.id, r.rating, r.comment, r.updated_at,
                SUBSTRING(u.full_name FROM '^[^ ]+') AS author
         FROM reviews r JOIN users u ON u.id = r.user_id
         WHERE r.reviewed_entity_type = $1 AND r.reviewed_entity_id = $2
           AND r.status = 'approved' AND r.deleted_at IS NULL
           AND EXISTS (
             ${kind === 'business'
               ? "SELECT 1 FROM businesses b JOIN users owner ON owner.id = b.owner_id WHERE b.id = $2 AND b.status = 'active' AND b.deleted_at IS NULL AND owner.status = 'active'"
               : "SELECT 1 FROM products p JOIN businesses b ON b.id = p.business_id JOIN users owner ON owner.id = b.owner_id WHERE p.id = $2 AND p.status = 'active' AND p.deleted_at IS NULL AND b.status = 'active' AND b.deleted_at IS NULL AND owner.status = 'active'"}
           )
         ORDER BY r.user_id, r.updated_at DESC NULLS LAST, r.id DESC
       )
       SELECT id, rating, comment, updated_at, author FROM latest
       WHERE NULLIF(TRIM(comment), '') IS NOT NULL ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 11 OFFSET $3`,
      [kind, id, page * 10]
    );
    return res.json({ comments: result.rows.slice(0, 10), hasMore: result.rows.length > 10 });
  } catch (error) {
    next(error);
  }
}

export async function getMyMarketplaceReview(req: AuthRequest, res: Response, next: NextFunction) {
  const { kind, id } = req.params;
  if (!validTarget(kind, id)) return res.status(400).json({ error: 'Item inválido.' });
  if (req.userType !== 'customer' || !req.userId) return res.status(403).json({ error: 'Acesso exclusivo para clientes.' });
  try {
    const purchase = await query(paidPurchase(kind), [req.userId, id]);
    if (!purchase.rows.length) return res.json({ eligible: false, review: null });

    const result = await query(
      `SELECT rating, comment, status FROM reviews WHERE reviewed_entity_type = $1 AND reviewed_entity_id = $2
         AND user_id = $3 AND deleted_at IS NULL
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`,
      [kind, id, req.userId]
    );
    return res.json({ eligible: true, review: result.rows[0] ?? null });
  } catch (error) {
    next(error);
  }
}

export async function rateMarketplaceItem(req: AuthRequest, res: Response) {
  if (req.userType !== 'customer' || !req.userId) {
    return res.status(403).json({ error: 'Entre com uma conta de cliente para avaliar.' });
  }

  const { kind, id } = req.params;
  const input = req.body || {};
  const rating = input.rating ?? null;
  const comment = typeof input.comment === 'string' ? input.comment.trim() : null;
  if (!validTarget(kind, id) || (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) ||
      (input.comment != null && typeof input.comment !== 'string') || (comment?.length ?? 0) > 1500 ||
      (rating === null && !comment)) {
    return res.status(400).json({ error: 'Escreva um comentário de até 1.500 caracteres ou escolha de uma a cinco estrelas.' });
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

    const purchase = await client.query(paidPurchase(kind), [req.userId, id]);
    if (!purchase.rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: business
        ? 'Você precisa ter uma compra paga nesta loja para avaliá-la.'
        : 'Você precisa ter comprado este produto para avaliá-lo.' });
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
      await client.query('UPDATE reviews SET rating = $1, comment = CASE WHEN $4 THEN $2 ELSE comment END, updated_at = NOW() WHERE id = $3',
        [rating, comment || null, review.id, Object.prototype.hasOwnProperty.call(input, 'comment')]);
    } else {
      await client.query(
        'INSERT INTO reviews (reviewed_entity_type, reviewed_entity_id, user_id, rating, comment) VALUES ($1, $2, $3, $4, $5)',
        [kind, id, req.userId, rating, comment || null]
      );
    }
    const summary = await client.query(
      `WITH latest AS (
         SELECT DISTINCT ON (user_id) rating FROM reviews
         WHERE reviewed_entity_type = $1 AND reviewed_entity_id = $2 AND status = 'approved' AND deleted_at IS NULL
         ORDER BY user_id, updated_at DESC NULLS LAST, id DESC
       ), totals AS (
         SELECT COALESCE(ROUND(AVG(rating), 2), 0) AS rating, COUNT(rating)::int AS rating_count FROM latest
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
