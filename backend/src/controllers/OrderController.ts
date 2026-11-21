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
  async createOrder(req: AuthRequest, res: Response) {
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

      await client.query('COMMIT');
      inTransaction = false;
      return res.status(201).json({ orderId: orderIds[0], orderIds, status: 'pending' });
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
        `SELECT o.id, o.total AS total_amount, o.order_status AS status, o.created_at,
                COALESCE(json_agg(
                  json_build_object('productId', oi.product_id, 'quantity', oi.quantity, 'unitPrice', oi.product_price, 'productName', oi.product_name)
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         WHERE o.user_id = $1
         GROUP BY o.id, o.total, o.order_status, o.created_at
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
                o.payment_method, o.payment_status, o.delivery_type, o.delivery_address,
                COALESCE(json_agg(
                  json_build_object('productId', oi.product_id, 'quantity', oi.quantity, 'unitPrice', oi.product_price, 'productName', oi.product_name)
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         WHERE o.id = $1 AND o.user_id = $2
         GROUP BY o.id, o.total, o.order_status, o.created_at, o.payment_method, o.payment_status, o.delivery_type, o.delivery_address`,
        [orderId, req.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }

      res.json(result.rows[0]);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new OrderController();
