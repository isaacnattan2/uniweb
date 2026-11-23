import { createHash } from 'node:crypto';
import { notifyOrderEvent } from '../services/OrderPush';
import { AsaasPixKeyMissingError, checkoutIdPattern, checkoutUrl, createAsaasCheckout, getAsaasConfig, getAsaasInstallmentCount } from '../services/AsaasCheckout';
import { v4 as uuidv4 } from 'uuid';
import { Response } from 'express';
import { PoolClient } from 'pg';
import { AuthRequest } from '../middleware/auth';
import { formatDeliveryAddress, normalizeDeliveryAddress } from '../services/DeliveryAddress';
import { lockCart } from '../services/CustomerCart';
import { getClient, query } from '../config/database';
import { applyCoupon, Coupon, CouponError, normalizeCouponCode } from '../services/StoreCoupons';
import { dispatchUuid, dispatchWindowMinutes, findDispatchCandidates } from '../services/DeliveryDispatch';

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
  category: string | null;
  payment_methods: string[];
  max_card_installments: number;
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
      const quoteId = deliveryType === 'delivery' ? req.body?.deliveryQuoteId : null;
      const scheduledAt = deliveryType === 'delivery' ? req.body?.scheduledAt ?? null : null;
      const slot = typeof scheduledAt === 'string' ? new Date(scheduledAt) : null;
      if (deliveryType === 'delivery' && (!config || req.body?.deliveryFeeAccepted !== true ||
          typeof quoteId !== 'string' || !dispatchUuid.test(quoteId) ||
          (scheduledAt !== null && (!slot || !Number.isFinite(slot.getTime()) || slot.getTime() % 1800000 !== 0)))) {
        throw new CheckoutError(400, 'Calcule e aceite o frete antes de iniciar o pagamento.');
      }
      const inputCode = req.body?.couponCode;
      if (inputCode != null && (typeof inputCode !== 'string' || inputCode.length > 64)) {
        throw new CheckoutError(400, 'Código de cupom inválido.');
      }
      const couponCode = inputCode ? normalizeCouponCode(inputCode) : '';
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
      const savedAddress = deliveryType === 'pickup' ? null : normalizeDeliveryAddress(deliveryAddress);
      const address = deliveryType === 'pickup' && typeof deliveryAddress !== 'string' ? '' : formatDeliveryAddress(deliveryAddress) || '';
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
        ...(couponCode ? [couponCode] : []),
        ...(quoteId ? [quoteId, slot?.toISOString() ?? null] : []),
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
      if (config) await lockCart(client, req.userId);
      const result = await client.query<CheckoutProduct>(
        `SELECT p.id, p.business_id, p.name, p.price, p.stock, p.category, b.payment_methods, b.max_card_installments
         FROM products p
         JOIN businesses b ON b.id = p.business_id
         JOIN users u ON u.id = b.owner_id
         WHERE p.id = ANY($1::uuid[]) AND p.status = 'active' AND p.deleted_at IS NULL
           AND b.status = 'active' AND b.deleted_at IS NULL AND u.status = 'active'
         ORDER BY p.id
         FOR UPDATE OF p FOR SHARE OF b, u`,
        [[...itemById.keys()]]
      );
      if (result.rows.length !== itemById.size) {
        throw new CheckoutError(409, 'Um produto ou loja não está mais disponível. Atualize o carrinho.');
      }

      const groups = new Map<string, Array<{ product: CheckoutProduct; item: CheckoutItem; subtotal: bigint }>>();
      for (const product of result.rows) {
        const item = itemById.get(product.id);
        if (!item) throw new Error('Produto retornado não pertence ao carrinho.');
        if (!product.payment_methods.includes(paymentMethod)) {
          throw new CheckoutError(409, 'Uma loja do carrinho não aceita essa forma de pagamento. Escolha outra opção ou revise o carrinho.');
        }
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

      if (couponCode && groups.size !== 1) {
        throw new CheckoutError(400, 'Use um cupom por compra de uma loja.');
      }
      let quote;
      let promisedAt: Date | undefined;
      let reservedDriver: string | null = null;
      if (quoteId) {
        if (groups.size !== 1) throw new CheckoutError(400, 'Finalize a entrega de uma loja por vez.');
        const { rows } = await client.query(
          `SELECT * FROM delivery_quotes WHERE id = $1 AND user_id = $2 AND business_id = $3
           AND destination = $4 AND expires_at > NOW() FOR UPDATE`,
          [quoteId, req.userId, [...groups.keys()][0], address]
        );
        quote = rows[0];
        if (!quote || (slot && (slot.getTime() < Date.now() + 40 * 60000 || slot.getTime() > Date.now() + 7 * 86400000))) {
          throw new CheckoutError(409, 'O frete ou o horário expirou. Atualize a cotação.');
        }
        if (!slot && quote.immediate_minutes == null) throw new CheckoutError(409, 'A entrega imediata não está disponível.');
        if (slot) await client.query('SELECT pg_advisory_xact_lock(19750215)');
        const candidates = await findDispatchCandidates(client, quote, slot);
        if (!candidates.length) throw new CheckoutError(409, 'Este tipo de entrega ficou indisponível. Atualize a cotação.');
        reservedDriver = slot ? candidates[0].user_id : null;
        promisedAt = new Date((slot?.getTime() ?? Date.now()) +
          (slot ? dispatchWindowMinutes(quote) : quote.immediate_minutes) * 60000);
        await client.query('DELETE FROM delivery_quotes WHERE id = $1', [quoteId]);
      }

      const orderIds: string[] = [];
      const checkoutItems: Array<{ name: string; value: number; quantity: number }> = [];
      for (const [businessId, group] of groups) {
        const subtotal = group.reduce((sum, entry) => sum + entry.subtotal, 0n);
        const deliveryFee = BigInt(quote?.fee_cents ?? 0);
        if (subtotal + deliveryFee > 999999999999999n) {
          throw new CheckoutError(400, 'O valor do pedido excede o limite permitido.');
        }
        let pricedItems = group.map((entry) => ({ ...entry, discount: 0n }));
        if (couponCode) {
          const coupons = await client.query<Coupon>(
            'SELECT * FROM business_coupons WHERE business_id = $1 AND code = $2 AND active FOR SHARE',
            [businessId, couponCode]
          );
          if (!coupons.rows.length) throw new CouponError('Cupom inválido ou inativo para esta loja.');
          pricedItems = applyCoupon(group, coupons.rows[0]);
        }
        const discount = pricedItems.reduce((sum, entry) => sum + entry.discount, 0n);
        if (couponCode && subtotal === discount) {
          throw new CouponError('Este cupom zera o pedido. Adicione outros itens ou use outro cupom.');
        }

        const orderId = uuidv4();
        const amount = formatCents(subtotal);
        await client.query(
          `INSERT INTO orders (id, user_id, business_id, order_number, subtotal, total, payment_method, delivery_type, delivery_address, discount, coupon_code, delivery_fee)
           VALUES ($1, $2, $3, $4, $5, $9, $6, $7, $8, $10, $11, $12)`,
          [orderId, req.userId, businessId, orderId, amount, paymentMethod, deliveryType, deliveryType === 'pickup' ? null : address,
            formatCents(subtotal - discount + deliveryFee), formatCents(discount), couponCode || null, formatCents(deliveryFee)]
        );
        if (quote) {
          await client.query(
            `INSERT INTO delivery_dispatch (order_id, state, slot_at, promised_at, pickup_address, pickup_latitude, pickup_longitude,
              distance_meters, duration_minutes, rate_cents, fee_cents, subsidy_cents, radius_meters, capacity_driver_id)
             VALUES ($1,'payment_pending',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [orderId, slot, promisedAt, quote.pickup_address, quote.pickup_latitude, quote.pickup_longitude, quote.distance_meters,
              quote.duration_minutes, quote.rate_cents, quote.fee_cents, quote.subsidy_cents, quote.radius_meters, reservedDriver]
          );
          if (deliveryFee > 0n) checkoutItems.push({ name: 'Frete', quantity: 1, value: Number(formatCents(deliveryFee)) });
        }
        for (const { product, item, subtotal, discount: lineDiscount } of pricedItems) {
          if (config) {
            const quantity = BigInt(item.quantity);
            const net = subtotal - lineDiscount;
            const unitCents = net / quantity;
            const remainder = Number(net % quantity);
            if (unitCents > 0n || !couponCode) {
              checkoutItems.push({ name: product.name, value: Number(formatCents(unitCents)), quantity: item.quantity - remainder });
            }
            if (remainder) {
              checkoutItems.push({ name: product.name, value: Number(formatCents(unitCents + 1n)), quantity: remainder });
            }
          }
          await client.query(
            `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity, subtotal)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [uuidv4(), orderId, product.id, product.name, product.price, item.quantity, formatCents(subtotal)]
          );
          await client.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [product.id, item.quantity]);
        }
        orderIds.push(orderId);
      }

      if (savedAddress) {
        await client.query(
          'INSERT INTO customer_addresses (user_id, address) VALUES ($1, $2::jsonb) ON CONFLICT (user_id, address) DO NOTHING',
          [req.userId, JSON.stringify(savedAddress)]
        );
      }

      let paymentUrl: string | undefined;
      if (config) {
        let providerId: string;
        try {
          const maxCardInstallments = Math.min(...result.rows.map((product) => product.max_card_installments));
          providerId = await createAsaasCheckout(config, checkoutId, paymentMethod, checkoutItems, maxCardInstallments);
        } catch (error) {
          if (error instanceof AsaasPixKeyMissingError) {
            console.warn(error.message);
            throw new CheckoutError(503, 'Pix indisponível no momento. Escolha cartão de crédito ou tente novamente mais tarde.');
          }
          console.error('Falha ao abrir checkout Asaas:', error instanceof Error ? error.message : 'erro desconhecido');
          throw new CheckoutError(502, 'Não foi possível abrir o pagamento no Asaas. Tente novamente.');
        }
        await client.query(
          'INSERT INTO asaas_checkouts (id, user_id, request_hash, provider_id) VALUES ($1, $2, $3, $4)',
          [checkoutId, req.userId, requestHash, providerId]
        );
        await client.query('UPDATE orders SET asaas_checkout_id = $1 WHERE id = ANY($2::uuid[])', [checkoutId, orderIds]);
        await client.query(
          `WITH purchased AS (
             SELECT * FROM UNNEST($2::uuid[], $3::int[]) AS items(product_id, quantity)
           ), removed AS (
             DELETE FROM customer_cart_items c USING purchased p
             WHERE c.user_id = $1 AND c.product_id = p.product_id AND c.quantity <= p.quantity
           )
           UPDATE customer_cart_items c SET quantity = c.quantity - p.quantity FROM purchased p
           WHERE c.user_id = $1 AND c.product_id = p.product_id AND c.quantity > p.quantity`,
          [req.userId, [...itemById.keys()], [...itemById.values()].map((item) => item.quantity)]
        );
        paymentUrl = checkoutUrl(providerId);
      }
      await client.query('COMMIT');
      inTransaction = false;
      if (!quote) notifyOrderEvent('new', orderIds);
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
      if (error instanceof CouponError) return res.status(400).json({ error: error.message });
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
                o.delivery_type, o.delivery_status, o.delivery_fee, (o.delivery_driver_id IS NOT NULL) AS delivery_assigned,
                j.state AS dispatch_state, j.slot_at, j.promised_at, j.refund_state,
                COALESCE(json_agg(
                  json_build_object('productId', oi.product_id, 'quantity', oi.quantity, 'unitPrice', oi.product_price, 'productName', oi.product_name)
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         LEFT JOIN delivery_dispatch j ON j.order_id = o.id
         WHERE o.user_id = $1
         GROUP BY o.id, j.order_id
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
                o.payment_method, o.payment_status, o.delivery_type, o.delivery_address, o.subtotal, o.discount, o.coupon_code,
                o.delivery_status, o.delivery_fee, (o.delivery_driver_id IS NOT NULL) AS delivery_assigned,
                j.state AS dispatch_state, j.slot_at, j.promised_at, j.refund_state,
                CASE WHEN o.delivery_type = 'delivery' AND o.payment_status = 'paid'
                  AND o.order_status IN ('confirmed', 'processing') AND (j.state = 'in_transit' OR
                    (j.order_id IS NULL AND o.delivery_status = 'in_transit') OR
                    (j.order_id IS NULL AND o.delivery_status = 'processing'))
                  THEN o.delivery_confirmation_code END AS delivery_confirmation_code,
                c.provider_id, c.installment_count,
                COALESCE(json_agg(
                  json_build_object('productId', oi.product_id, 'quantity', oi.quantity, 'unitPrice', oi.product_price, 'productName', oi.product_name)
                ) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) AS items
         FROM orders o
         LEFT JOIN order_items oi ON o.id = oi.order_id
         LEFT JOIN asaas_checkouts c ON c.id = o.asaas_checkout_id
         LEFT JOIN delivery_dispatch j ON j.order_id = o.id
         WHERE o.id = $1 AND o.user_id = $2
         GROUP BY o.id, j.order_id, c.provider_id, c.installment_count`,
        [orderId, req.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }

      const { provider_id, ...order } = result.rows[0];
      if (provider_id && order.payment_method === 'credit_card' && order.payment_status === 'paid' &&
          order.installment_count === null) {
        try {
          const count = await getAsaasInstallmentCount(provider_id);
          if (count !== null) {
            await query(
              'UPDATE asaas_checkouts SET installment_count = $1 WHERE provider_id = $2 AND installment_count IS NULL',
              [count, provider_id]
            );
            order.installment_count = count;
          }
        } catch {
          console.warn('N?o foi poss?vel consultar o parcelamento do pedido no Asaas.');
        }
      }
      res.set('Cache-Control', 'no-store');
      res.json({
        ...order,
        checkoutUrl: provider_id && order.payment_status === 'pending' && order.status === 'pending' ? checkoutUrl(provider_id) : null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new OrderController();
