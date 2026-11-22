import { createHash } from 'node:crypto';
import { checkoutIdPattern, checkoutUrl, createAsaasCheckout, getAsaasConfig } from '../services/AsaasCheckout';
import { v4 as uuidv4 } from 'uuid';
import { Response } from 'express';
import { PoolClient } from 'pg';
import { AuthRequest } from '../middleware/auth';
import { getClient, query } from '../config/database';

class CheckoutError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface CheckoutItem {
  productId: string;
  quantity: number;
  price: number;
}

interface CheckoutProduct {
  id: string;
  business_id: string;
  name: string;
  price: string;
  stock: number;
}

function formatCents(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export class OrderController {
  async createOrder(req: AuthRequest, res: Response, startPayment = false) {
    let client: PoolClient | undefined;
    let inTransaction = false;
    let releaseError: Error | undefined;
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (req.userType !== 'customer') {
        return res.status(403).json({ error: 'Somente clientes podem criar pedidos.' });
      }

      const { items, paymentMethod, deliveryType, deliveryAddress } = req.body || {};
      const config = startPayment ? getAsaasConfig() : null;
      const checkoutId = req.body?.checkoutId;
      if (startPayment && !config) {
        throw new CheckoutError(503, 'O pagamento online ainda não está configurado.');
      }
      if (!startPayment && process.env.ASAAS_API_KEY?.trim()) {
        throw new CheckoutError(400, 'Use o checkout online para criar pedidos.');
      }
      if (startPayment && (typeof checkoutId !== 'string' || !checkoutIdPattern.test(checkoutId) ||
        !['pix', 'credit_card'].includes(paymentMethod))) {
        throw new CheckoutError(400, 'Selecione Pix ou cartão de crédito para pagar.');
      }
      if (!Array.isArray(items) || items.length === 0) {
        throw new CheckoutError(400, 'O carrinho está vazio.');
      }
      if (!['pix', 'credit_card', 'debit_card', 'wallet'].includes(paymentMethod)) {
        throw new CheckoutError(400, 'Selecione uma forma de pagamento válida.');
      }
      if (!['pickup', 'delivery', 'shipping'].includes(deliveryType)) {
        throw new CheckoutError(400, 'Selecione uma forma de entrega válida.');
      }
      const address = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
      if (deliveryType !== 'pickup' && !address) {
        throw new CheckoutError(400, 'Informe o endereço de entrega.');
      }
      if (address.length > 1000) {
        throw new CheckoutError(400, 'O endereço deve ter no máximo 1000 caracteres.');
      }

      const itemById = new Map<string, CheckoutItem>();
      for (const item of items) {
        if (!item || typeof item.productId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.productId) ||
          !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 2147483647 ||
          typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0 ||
          !Number.isSafeInteger(Math.round(item.price * 100))) {
          throw new CheckoutError(400, 'Os itens do carrinho são inválidos.');
        }
        const productId = item.productId.toLowerCase();
        if (itemById.has(productId)) {
          throw new CheckoutError(400, 'O carrinho contém um produto duplicado.');
        }
        itemById.set(productId, { productId, quantity: item.quantity, price: item.price });
      }

      client = await getClient();
      await client.query('BEGIN');
      inTransaction = true;
      const requestHash = createHash('sha256').update(JSON.stringify([
        paymentMethod, deliveryType, address, [...itemById.values()].sort((a, b) => a.productId.localeCompare(b.productId)),
      ])).digest('hex');
      if (config) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [checkoutId]);
        const existing = await client.query(
          `SELECT c.user_id, c.request_hash, c.provider_id, o.id, o.payment_status
           FROM asaas_checkouts c JOIN orders o ON o.asaas_checkout_id = c.id
           WHERE c.id = $1 ORDER BY o.id`, [checkoutId]
        );
        if (existing.rows.length) {
          const session = existing.rows[0];
          if (session.user_id !== req.userId || session.request_hash !== requestHash) {
            throw new CheckoutError(409, 'O identificador do checkout já está em uso.');
          }
          await client.query('COMMIT');
          inTransaction = false;
          return res.json({
            orderIds: existing.rows.map((row) => row.id),
            checkoutUrl: session.payment_status === 'pending' ? checkoutUrl(session.provider_id) : null,
          });
        }
      }
      const result = await client.query<CheckoutProduct>(
        `SELECT p.id, p.business_id, p.name, p.price, p.stock
         FROM products p
         JOIN businesses b ON b.id = p.business_id
         WHERE p.id = ANY($1::uuid[]) AND p.status = 'active' AND p.deleted_at IS NULL
           AND b.status = 'active' AND b.deleted_at IS NULL
         ORDER BY p.id
         FOR UPDATE OF p`,
        [[...itemById.keys()]]
      );
      if (result.rows.length !== itemById.size) {
        throw new CheckoutError(409, 'Um produto ou loja não está mais disponível. Atualize o carrinho.');
      }

      const groups = new Map<string, Array<{ product: CheckoutProduct; item: CheckoutItem; subtotal: bigint }>>();
      for (const product of result.rows) {
        const item = itemById.get(product.id);
        if (!item) throw new Error('Produto retornado não pertence ao carrinho.');
        if (product.stock < item.quantity) {
          throw new CheckoutError(409, `Estoque insuficiente para ${product.name}.`);
        }
        const match = /^(\d+)\.(\d{2})$/.exec(product.price);
        if (!match) throw new Error('Preço inválido no banco de dados.');
        const priceCents = BigInt(match[1]) * 100n + BigInt(match[2]);
        if (BigInt(Math.round(item.price * 100)) !== priceCents) {
          throw new CheckoutError(409, `O preço de ${product.name} mudou. Remova o item e adicione-o novamente.`);
        }
        const group = groups.get(product.business_id) || [];
        group.push({ product, item, subtotal: priceCents * BigInt(item.quantity) });
        groups.set(product.business_id, group);
      }

      const orderIds: string[] = [];
      for (const [businessId, group] of groups) {
        const total = group.reduce((sum, entry) => sum + entry.subtotal, 0n);
        if (total > 999999999999999n) {
          throw new CheckoutError(400, 'O valor do pedido excede o limite permitido.');
        }
        const orderId = uuidv4();
        const amount = formatCents(total);
        await client.query(
          `INSERT INTO orders (id, user_id, business_id, order_number, subtotal, total, payment_method, delivery_type, delivery_address)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
          [orderId, req.userId, businessId, orderId, amount, paymentMethod, deliveryType, deliveryType === 'pickup' ? null : address]
        );
        for (const { product, item, subtotal } of group) {
          await client.query(
            `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uuidv4(), orderId, product.id, product.name, product.price, item.quantity, formatCents(subtotal)]
          );
          await client.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [product.id, item.quantity]);
        }
        orderIds.push(orderId);
      }

      let paymentUrl: string | undefined;
      if (config) {
        const checkoutItems = result.rows.map((product) => ({
          name: product.name,
          value: Number(product.price),
          quantity: itemById.get(product.id)!.quantity,
        }));
        let providerId: string;
        try {
          providerId = await createAsaasCheckout(config, checkoutId, paymentMethod, checkoutItems);
        } catch (error) {
          console.error('Falha ao abrir checkout Asaas:', error instanceof Error ? error.message : 'erro desconhecido');
          throw new CheckoutError(502, 'Não foi possível abrir o pagamento no Asaas. Tente novamente.');
        }
        await client.query(
          'INSERT INTO asaas_checkouts (id, user_id, request_hash, provider_id) VALUES ($1, $2, $3, $4)',
          [checkoutId, req.userId, requestHash, providerId]
        );
        await client.query('UPDATE orders SET asaas_checkout_id = $1 WHERE id = ANY($2::uuid[])', [checkoutId, orderIds]);
        paymentUrl = checkoutUrl(providerId);
      }
      await client.query('COMMIT');
      inTransaction = false;
      return res.status(201).json({ orderId: orderIds[0], orderIds, status: 'pending', ...(paymentUrl && { checkoutUrl: paymentUrl }) });
    } catch (error: unknown) {
      if (client && inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Erro ao desfazer criação de pedidos:', rollbackError);
          releaseError = rollbackError instanceof Error ? rollbackError : new Error('Falha ao desfazer transação.');
        }
      }
      if (error instanceof CheckoutError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Erro ao criar pedidos:', error);
      return res.status(500).json({ error: 'Não foi possível criar o pedido. Tente novamente.' });
    } finally {
      client?.release(releaseError);
    }
  }

  async getMyOrders(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const result = await query(
        `SELECT o.id, o.total AS total_amount, o.order_status AS status, o.created_at, o.payment_status,
                COALESCE(json_agg(
                  json_build_object('productId', oi.product_id, 'quantity', oi.quantity, 'unitPrice', oi.product_price, 'productName', oi.product_name)
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         WHERE o.user_id = $1
         GROUP BY o.id, o.total, o.order_status, o.created_at, o.payment_status
         ORDER BY o.created_at DESC`,
        [req.userId]
      );

      res.json(result.rows);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getOrder(req: AuthRequest, res: Response) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { orderId } = req.params;

      const result = await query(
        `SELECT o.id, o.total AS total_amount, o.order_status AS status, o.created_at,
                o.payment_method, o.payment_status, o.delivery_type, o.delivery_address, c.provider_id,
                COALESCE(json_agg(
                  json_build_object('productId', oi.product_id, 'quantity', oi.quantity, 'unitPrice', oi.product_price, 'productName', oi.product_name)
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         LEFT JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id
         WHERE o.id = $1 AND o.user_id = $2
         GROUP BY o.id, o.total, o.order_status, o.created_at, o.payment_method, o.payment_status, o.delivery_type, o.delivery_address, c.provider_id`,
        [orderId, req.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const { provider_id, ...order } = result.rows[0];
      res.json({
        ...order,
        checkoutUrl: provider_id && order.payment_status === 'pending' ? checkoutUrl(provider_id) : null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new OrderController();
