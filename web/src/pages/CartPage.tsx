import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StorePaymentMethod } from '../context/store';
import { createOrder, getBusinessPublic } from '../services/api';
import { DEFAULT_CARD_INSTALLMENTS, useCartStore, useAuthStore } from '../context/store';
import '../styles/cart.css';

export function CartPage() {
  const navigate = useNavigate();
  const cart = useCartStore((state) => state.items);
  const getTotal = useCartStore((state) => state.getTotal);
  const removeFromCart = useCartStore((state) => state.removeFromCart);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeStoreFromCart = useCartStore((state) => state.removeStoreFromCart);
  const { userId, token, userType } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [checkoutStore, setCheckoutStore] = useState('');
  const [availability, setAvailability] = useState<{ key: string; methods: StorePaymentMethod[]; maxCardInstallments?: number; failed?: boolean }>();
  const [deliveryType, setDeliveryType] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const checkoutAttempt = useRef<{ signature: string; id: string } | null>(null);
  const submitting = useRef(false);

  const total = getTotal();
  const storeIds = [...new Set(cart.map((item) => item.businessId))].sort();
  const storeCount = storeIds.length;
  const selectedStore = storeIds.includes(checkoutStore) ? checkoutStore : storeIds[0];
  const storeItems = cart.filter((item) => item.businessId === selectedStore);
  const storeTotal = storeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const available = availability?.key === selectedStore ? availability : undefined;
  const maxCardInstallments = available?.maxCardInstallments ?? DEFAULT_CARD_INSTALLMENTS;
  const selectedMethod = available?.methods.find((method) => method === paymentMethod);

  useEffect(() => {
    if (!token || userType !== 'customer' || !selectedStore) return;

    let active = true;
    getBusinessPublic(selectedStore).then((business) => {
      const methods = business.payment_methods ?? ['pix', 'credit_card'];
      if (active) setAvailability({ key: selectedStore, methods, maxCardInstallments: business.max_card_installments });
    }).catch(() => {
      if (active) setAvailability({ key: selectedStore, methods: [], failed: true });
    });
    return () => { active = false; };
  }, [selectedStore, token, userType]);

  async function handleCheckout() {
    if (submitting.current) return;
    if (!token || !userId) {
      navigate('/login', { state: { from: '/cart' } });
      return;
    }
    if (userType !== 'customer') {
      setError('Entre com uma conta de cliente para finalizar a compra.');
      return;
    }
    if (!selectedStore || !selectedMethod) {
      setError('Selecione uma forma de pagamento.');
      return;
    }
    if (deliveryType !== 'pickup' && deliveryType !== 'delivery' && deliveryType !== 'shipping') {
      setError('Selecione uma forma de entrega.');
      return;
    }
    if (deliveryType !== 'pickup' && !deliveryAddress.trim()) {
      setError('Informe o endereço de entrega.');
      return;
    }

    submitting.current = true;
    setLoading(true);
    setError('');

    try {
      const items = storeItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      }));

      const signature = JSON.stringify([userId, items, paymentMethod, deliveryType, deliveryAddress.trim()]);
      if (checkoutAttempt.current?.signature !== signature) {
        checkoutAttempt.current = { signature, id: crypto.randomUUID() };
      }
      const { checkoutUrl } = await createOrder(
        items, selectedMethod, deliveryType, deliveryAddress.trim(), checkoutAttempt.current.id
      );
      removeStoreFromCart(selectedStore);
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      navigate('/orders');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao criar pedido');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="cart-page">
        <div className="container">
          <h1>🛒 Meu Carrinho</h1>
          <div className="empty-cart">
            <p>Seu carrinho está vazio</p>
            <button onClick={() => navigate('/shop')} className="btn-primary">
              Voltar às Compras
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <div className="container">
        <h1>🛒 Meu Carrinho ({cart.length} itens)</h1>

        {error && <div className="error-message" role="alert">{error}</div>}

        <div className="cart-content">
          <div className="cart-items">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Loja</th>
                  <th>Preço</th>
                  <th>Quantidade</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.name}</td>
                    <td>{item.businessName || 'Loja'}</td>
                    <td>R$ {Number(item.price).toFixed(2)}</td>
                    <td>
                      <div className="quantity-control">
                        <button disabled={loading} aria-label={`Diminuir quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity - 1)}>-</button>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          disabled={loading}
                          value={item.quantity}
                          onChange={(e) => {
                            const quantity = Number(e.target.value);
                            if (Number.isInteger(quantity) && quantity > 0) updateQuantity(item.productId, quantity);
                          }}
                          aria-label={`Quantidade de ${item.name}`}
                        />
                        <button disabled={loading} aria-label={`Aumentar quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity + 1)}>+</button>
                      </div>
                    </td>
                    <td>R$ {(item.price * item.quantity).toFixed(2)}</td>
                    <td>
                      <button
                        onClick={() => removeFromCart(item.productId)}
                        disabled={loading}
                        className="btn-remove"
                        aria-label={`Remover ${item.name}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cart-summary">
            <div className="summary-box">
              <h3>Resumo da Compra</h3>
              <div className="summary-row">
                <span>Itens:</span>
                <span>{cart.length}</span>
              </div>
              <div className="summary-row">
                <span>Subtotal:</span>
                <span>R$ {total.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Frete:</span>
                <span>Não calculado</span>
              </div>
              <div className="summary-row total">
                <span>Total:</span>
                <span>R$ {total.toFixed(2)}</span>
              </div>

              {token && userType === 'customer' && (
                <div className="checkout-options">
                  {storeCount > 1 && (
                    <>
                      <label htmlFor="checkout-store">Loja que você quer pagar</label>
                      <select id="checkout-store" value={selectedStore} disabled={loading} onChange={(event) => {
                        setCheckoutStore(event.target.value);
                        setPaymentMethod('');
                        setError('');
                      }}>
                        {storeIds.map((id) => (
                          <option key={id} value={id}>{cart.find((item) => item.businessId === id)?.businessName || 'Loja'}</option>
                        ))}
                      </select>
                      <p><strong>Total desta cobrança:</strong> {storeTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Os itens das outras lojas ficam no carrinho.</p>
                    </>
                  )}
                  <label htmlFor="payment-method">Forma de pagamento</label>
                  <select id="payment-method" value={selectedMethod || ''} onChange={(event) => setPaymentMethod(event.target.value)} disabled={loading || !available?.methods.length}>
                    <option value="">Selecione</option>
                    {available?.methods.includes('pix') && <option value="pix">Pix</option>}
                    {available?.methods.includes('credit_card') && <option value="credit_card">Cartão de crédito</option>}

                  </select>
                  {!available && <p role="status">Consultando formas de pagamento da loja…</p>}
                  {available?.failed && <p role="alert">Não foi possível consultar as formas de pagamento. Atualize a página para tentar novamente.</p>}
                  {available && !available.failed && !available.methods.length && (
                    <p role="alert">Esta loja está sem formas de pagamento disponíveis.</p>
                  )}
                  <label htmlFor="delivery-type">Forma de entrega</label>
                  <select id="delivery-type" value={deliveryType} onChange={(event) => setDeliveryType(event.target.value)} disabled={loading}>
                    <option value="">Selecione</option>
                    <option value="pickup">Retirada na loja</option>
                    <option value="delivery">Entrega</option>
                    <option value="shipping">Envio</option>
                  </select>
                  {(deliveryType === 'delivery' || deliveryType === 'shipping') && (
                    <>
                      <label htmlFor="delivery-address">Endereço de entrega</label>
                      <textarea id="delivery-address" value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} maxLength={1000} disabled={loading} />
                    </>
                  )}
                  {selectedMethod === 'credit_card' && (
                    <p>{maxCardInstallments === 1 ? 'Cartão à vista.' : `Até ${maxCardInstallments}× sem juros no cartão.`}</p>
                  )}
                  <p>Você vai concluir o pagamento na página do Asaas. O total não inclui frete.</p>
                </div>
              )}

              {!token ? (
                <>
                  <div style={{ marginTop: '15px', padding: '15px', background: '#fff3cd', borderRadius: '5px', textAlign: 'center', marginBottom: '15px' }}>
                    <p style={{ margin: '0 0 10px 0', color: '#856404' }}>
                      ✓ Faça login para finalizar a compra
                    </p>
                  </div>
                  <button
                    onClick={handleCheckout}
                    className="btn-checkout"
                  >
                    🔐 Fazer Login e Finalizar Compra
                  </button>
                </>
              ) : userType === 'customer' ? (
                <button
                  onClick={handleCheckout}
                  disabled={loading || !available?.methods.length}
                  className="btn-checkout"
                >
                  {loading ? 'Processando...' : storeCount > 1 ? 'Pagar esta loja' : '✓ Finalizar Compra'}
                </button>
              ) : (
                <p>Entre com uma conta de cliente para finalizar a compra.</p>
              )}

              <button
                onClick={() => navigate('/shop')}
                className="btn-secondary"
              >
                ← Continuar Comprando
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
