import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StorePaymentMethod } from '../context/store';
import { createOrder, getBusinessPublic, getDeliveryQuote, getSavedDeliveryAddresses } from '../services/api';
import type { DeliveryQuote, SavedDeliveryAddress } from '../services/api';
import { DEFAULT_CARD_INSTALLMENTS, useCartStore, useAuthStore } from '../context/store';
import { CheckoutAddress, emptyDeliveryAddress, isDeliveryAddressComplete } from '../components/CheckoutAddress';
import '../styles/cart.css';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const slotLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const hourLabel = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });

export function CartPage() {
  const navigate = useNavigate();
  const cart = useCartStore((state) => state.items);
  const getTotal = useCartStore((state) => state.getTotal);
  const removeFromCart = useCartStore((state) => state.removeFromCart);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const cartReady = useCartStore((state) => state.ready);
  const cartSyncing = useCartStore((state) => state.syncing);
  const cartError = useCartStore((state) => state.error);
  const refreshCart = useCartStore((state) => state.refresh);
  const { userId, token, userType } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [checkoutStore, setCheckoutStore] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [availability, setAvailability] = useState<{ key: string; methods: StorePaymentMethod[]; maxCardInstallments?: number; pickupAddress?: string | null; failed?: boolean }>();
  const [deliveryType, setDeliveryType] = useState('');
  const [deliveryQuote, setDeliveryQuote] = useState<{ key: string; data: DeliveryQuote }>();
  const [quoting, setQuoting] = useState(false);
  const [deliverySelection, setDeliverySelection] = useState<{ quoteId: string; value: string }>();
  const [acceptedFee, setAcceptedFee] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState(emptyDeliveryAddress);
  const [addressBook, setAddressBook] = useState<{ userId: string; entries: SavedDeliveryAddress[]; failed?: boolean }>();
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const savedAddresses = addressBook?.userId === userId ? addressBook : undefined;
  const activeAddressId = selectedAddressId || savedAddresses?.entries[0]?.id || 'new';
  const activeAddress = activeAddressId === 'new' ? deliveryAddress : savedAddresses?.entries.find((entry) => entry.id === activeAddressId)?.address;
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
  const quoteKey = JSON.stringify([selectedStore, activeAddress, userId, deliveryType]);
  const quote = deliveryQuote?.key === quoteKey ? deliveryQuote.data : undefined;
  const selectedDelivery = quote && deliverySelection?.quoteId === quote.id ? deliverySelection.value : '';
  const feeAccepted = !!quote && !!selectedDelivery && acceptedFee === quote.id + selectedDelivery;
  const addressComplete = !!savedAddresses && !!activeAddress && isDeliveryAddressComplete(activeAddress);
  const hasDeliveryOptions = !!quote && (quote.immediateMinutes !== null || quote.slots.length > 0);
  let checkoutBlocker = '';
  if (cartSyncing > 0) checkoutBlocker = 'Aguarde a atualização do carrinho.';
  else if (!available) checkoutBlocker = 'Aguarde a consulta das formas de pagamento.';
  else if (available.failed) checkoutBlocker = 'Atualize a página para consultar as formas de pagamento novamente.';
  else if (!available.methods.length) checkoutBlocker = 'Esta loja está sem formas de pagamento disponíveis.';
  else if (!selectedMethod) checkoutBlocker = 'Selecione uma forma de pagamento.';
  else if (!deliveryType) checkoutBlocker = 'Selecione uma forma de entrega.';
  else if (deliveryType !== 'pickup' && !addressComplete) checkoutBlocker = 'Informe o endereço de entrega completo.';
  else if (deliveryType === 'delivery') {
    if (quoting) checkoutBlocker = 'Aguarde o cálculo do frete.';
    else if (!quote) checkoutBlocker = 'Clique em Calcular frete.';
    else if (!hasDeliveryOptions) checkoutBlocker = 'Nenhum prazo disponível para este endereço. Atualize o frete ou escolha retirada na loja.';
    else if (!selectedDelivery) checkoutBlocker = 'Escolha um prazo de entrega.';
    else if (!feeAccepted) checkoutBlocker = 'Marque a opção “Aceito o frete” para continuar.';
  }

  async function calculateFreight() {
    if (!selectedStore || !activeAddress || !isDeliveryAddressComplete(activeAddress) || quoting) return;
    setQuoting(true);
    setDeliveryQuote(undefined);
    setError('');
    try {
      setDeliveryQuote({ key: quoteKey, data: await getDeliveryQuote(selectedStore, activeAddress) });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível calcular o frete.');
    } finally {
      setQuoting(false);
    }
  }

  useEffect(() => {
    if (!token || userType !== 'customer' || !selectedStore) return;

    let active = true;
    getBusinessPublic(selectedStore).then((business) => {
      const methods = business.payment_methods ?? ['pix', 'credit_card'];
      if (active) setAvailability({ key: selectedStore, methods, maxCardInstallments: business.max_card_installments, pickupAddress: business.address });
    }).catch(() => {
      if (active) setAvailability({ key: selectedStore, methods: [], failed: true });
    });
    return () => { active = false; };
  }, [selectedStore, token, userType]);

  useEffect(() => {
    setAddressBook(undefined);
    setSelectedAddressId('');
    setDeliveryAddress(emptyDeliveryAddress);
    if (!token || userType !== 'customer' || !userId) return;
    const request = new AbortController();
    getSavedDeliveryAddresses(request.signal).then((entries) => {
      if (!request.signal.aborted) setAddressBook({ userId, entries });
    }).catch(() => {
      if (!request.signal.aborted) setAddressBook({ userId, entries: [], failed: true });
    });
    return () => request.abort();
  }, [token, userId, userType]);

  async function handleCheckout() {
    if (submitting.current || useCartStore.getState().syncing > 0) return;
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
    if (deliveryType !== 'pickup' && (!savedAddresses || !activeAddress || !isDeliveryAddressComplete(activeAddress))) {
      setError('Informe CEP, logradouro, número, cidade e UF para continuar.');
      return;
    }
    if (deliveryType === 'delivery' && (!quote || !feeAccepted)) {
      setError('Calcule o frete, escolha o prazo e aceite o valor da entrega.');
      return;
    }

    const address = deliveryType === 'pickup' ? '' : activeAddress ?? '';
    const dispatch = deliveryType === 'delivery' && quote
      ? { deliveryQuoteId: quote.id, scheduledAt: selectedDelivery === 'immediate' ? null : selectedDelivery, deliveryFeeAccepted: true as const }
      : undefined;
    submitting.current = true;
    setLoading(true);
    setError('');

    try {
      const items = storeItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      }));

      const signature = JSON.stringify([userId, items, paymentMethod, deliveryType, address, couponCode.trim(), dispatch]);
      if (checkoutAttempt.current?.signature !== signature) {
        checkoutAttempt.current = { signature, id: crypto.randomUUID() };
      }
      const { checkoutUrl } = await createOrder(
        items, selectedMethod, deliveryType, address, checkoutAttempt.current.id, couponCode.trim(), dispatch
      );
      if (useAuthStore.getState().userId !== userId) return;
      if (checkoutUrl) {
        window.location.assign(checkoutUrl);
        return;
      }
      await refreshCart();
      navigate('/orders');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao criar pedido');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  if (!cartReady) {
    return <div className="cart-page"><div className="container">
      <h1>Meu carrinho</h1>
      {cartError ? <>
        <p className="error-message" role="alert">{cartError}</p>
        <button type="button" className="btn-secondary" disabled={cartSyncing > 0} onClick={() => void refreshCart()}>Tentar novamente</button>
      </> : <p role="status">Carregando seu carrinho…</p>}
    </div></div>;
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

        {(error || cartError) && <div className="error-message" role="alert">{error || cartError}</div>}

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
                        <button disabled={loading || cartSyncing > 0} aria-label={`Diminuir quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity - 1)}>-</button>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          key={item.quantity}
                          disabled={loading || cartSyncing > 0}
                          defaultValue={item.quantity}
                          onBlur={(event) => {
                            const quantity = Number(event.currentTarget.value);
                            if (Number.isInteger(quantity) && quantity > 0 && quantity !== item.quantity) {
                              const input = event.currentTarget;
                              void updateQuantity(item.productId, quantity).then((updated) => {
                                if (!updated) input.value = String(item.quantity);
                              });
                            } else event.currentTarget.value = String(item.quantity);
                          }}
                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                          aria-label={`Quantidade de ${item.name}`}
                        />
                        <button disabled={loading || cartSyncing > 0} aria-label={`Aumentar quantidade de ${item.name}`} onClick={() => updateQuantity(item.productId, item.quantity + 1)}>+</button>
                      </div>
                    </td>
                    <td>R$ {(item.price * item.quantity).toFixed(2)}</td>
                    <td>
                      <button
                        onClick={() => removeFromCart(item.productId)}
                        disabled={loading || cartSyncing > 0}
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
                <span>{quote ? currency.format(quote.feeCents / 100) : deliveryType === 'pickup' ? 'Sem frete' : 'Não calculado'}</span>
              </div>
              <div className="summary-row total">
                <span>Total:</span>
                <span>{currency.format(total + (quote?.feeCents ?? 0) / 100)}</span>
              </div>

              {token && userType === 'customer' && (
                <div className="checkout-options">
                  {storeCount > 1 && (
                    <>
                      <label htmlFor="checkout-store">Loja que você quer pagar</label>
                      <select id="checkout-store" value={selectedStore} disabled={loading} onChange={(event) => {
                        setCheckoutStore(event.target.value);
                        setPaymentMethod('');
                        setCouponCode('');
                        setError('');
                      }}>
                        {storeIds.map((id) => (
                          <option key={id} value={id}>{cart.find((item) => item.businessId === id)?.businessName || 'Loja'}</option>
                        ))}
                      </select>
                      <p><strong>Total desta cobrança:</strong> {currency.format(storeTotal + (quote?.feeCents ?? 0) / 100)}. Os itens das outras lojas ficam no carrinho.</p>
                    </>
                  )}
                  <label htmlFor="checkout-coupon">Cupom da loja (opcional)</label>
                  <input id="checkout-coupon" type="text" value={couponCode} maxLength={30} disabled={loading}
                    onChange={(event) => setCouponCode(event.target.value.toUpperCase())} />
                  {couponCode.trim() && <p>O desconto será validado ao continuar e o valor final aparecerá no Asaas.</p>}
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
                  <select id="delivery-type" value={deliveryType} onChange={(event) => { setDeliveryType(event.target.value); setDeliveryQuote(undefined); }} disabled={loading}>
                    <option value="">Selecione</option>
                    <option value="pickup">Retirada na loja</option>
                    <option value="delivery">Entrega</option>
                    <option value="shipping">Envio</option>
                  </select>
                  {deliveryType === 'pickup' && available?.pickupAddress && (
                    <p><strong>Endereço para retirada:</strong> {available.pickupAddress}</p>
                  )}
                  {(deliveryType === 'delivery' || deliveryType === 'shipping') && (
                    <div className="checkout-saved-address">
                      {!savedAddresses ? <p role="status">Consultando endereços da conta…</p> : (
                        <>
                          {savedAddresses.failed && <p role="status">Não foi possível carregar seus endereços. Você pode informar o endereço abaixo.</p>}
                          {!!savedAddresses.entries.length && (
                            <>
                              <label htmlFor="checkout-saved-address">Endereço de entrega</label>
                              <select id="checkout-saved-address" value={activeAddressId} disabled={loading}
                                onChange={(event) => setSelectedAddressId(event.target.value)}>
                                {savedAddresses.entries.map(({ id, address }, index) => (
                                  <option key={id} value={id}>{index === 0 ? 'Padrão — ' : ''}{address.street}, {address.number}{address.complement && ' · ' + address.complement} · {address.city}/{address.state} · {address.cep}</option>
                                ))}
                                <option value="new">Usar outro endereço</option>
                              </select>
                            </>
                          )}
                          {activeAddressId === 'new' ? (
                            <CheckoutAddress address={deliveryAddress} onChange={setDeliveryAddress} disabled={loading} />
                          ) : activeAddress && (
                            <p>{activeAddress.street}, {activeAddress.number}{activeAddress.complement && ' · ' + activeAddress.complement}
                              {activeAddress.neighborhood && ' · ' + activeAddress.neighborhood}
                              {' · ' + activeAddress.city + '/' + activeAddress.state + ' · CEP ' + activeAddress.cep}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {deliveryType === 'delivery' && (
                    <>
                      <button type="button" className="btn-secondary" disabled={loading || quoting || !activeAddress || !isDeliveryAddressComplete(activeAddress)}
                        onClick={() => void calculateFreight()}>{quoting ? 'Calculando frete…' : quote ? 'Atualizar frete' : 'Calcular frete'}</button>
                      {quote && quote.immediateMinutes === null && !quote.slots.length && (
                        <p role="status">Nenhuma entrega disponível para este endereço agora.</p>
                      )}
                      {quote && hasDeliveryOptions && (
                        <>
                          <label htmlFor="checkout-delivery-slot">Prazo da entrega</label>
                          <select id="checkout-delivery-slot" value={selectedDelivery} disabled={loading} onChange={(event) => {
                            setAcceptedFee('');
                            setDeliverySelection({ quoteId: quote.id, value: event.target.value });
                          }}>
                            <option value="">Selecione</option>
                            {quote.immediateMinutes !== null && <option value="immediate">Entrega imediata · cerca de {quote.immediateMinutes} min após o pagamento</option>}
                            {quote.slots.map((slot) => <option key={slot} value={slot}>
                              Agendar de {slotLabel.format(new Date(slot))} até {hourLabel.format(new Date(Date.parse(slot) + quote.windowMinutes * 60000))}
                            </option>)}
                          </select>
                          <label className="checkout-fee-consent">
                            <input type="checkbox" disabled={loading || !selectedDelivery} checked={feeAccepted}
                              onChange={(event) => setAcceptedFee(event.target.checked ? quote.id + selectedDelivery : '')} />
                            <span>Aceito o frete de {currency.format(quote.feeCents / 100)}.</span>
                          </label>
                        </>
                      )}
                    </>
                  )}
                  {selectedMethod === 'credit_card' && (
                    <p>{maxCardInstallments === 1 ? 'Cartão à vista.' : `Até ${maxCardInstallments}× no cartão.`}</p>
                  )}
                  <p>Você vai concluir o pagamento na página do Asaas.</p>
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
                <>
                  {!loading && checkoutBlocker && <p id="checkout-blocker" className="checkout-blocker" role="status">{checkoutBlocker}</p>}
                  <button
                    onClick={handleCheckout}
                    disabled={loading || !!checkoutBlocker}
                    aria-describedby={!loading && checkoutBlocker ? 'checkout-blocker' : undefined}
                    className="btn-checkout"
                  >
                    {loading ? 'Processando...' : storeCount > 1 ? 'Pagar esta loja' : '✓ Finalizar Compra'}
                  </button>
                </>
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
