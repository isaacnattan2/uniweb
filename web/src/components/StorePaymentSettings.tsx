import React, { useState } from 'react';
import { useFeedback } from './Feedback';
import axios from 'axios';
import { DEFAULT_CARD_INSTALLMENTS, MAX_CARD_INSTALLMENTS } from '../context/store';
import type { Business, StorePaymentMethod } from '../context/store';
import { updateBusiness } from '../services/api';

const paymentOptions = [
  {
    method: 'pix',
    label: 'Pix',
    instruction: 'O cliente paga por QR Code ou Pix Copia e Cola. A conta Asaas da plataforma precisa de uma chave Pix ativa.',
    receipt: 'Crédito após a confirmação do Pix.',
    rates: [{ label: 'Pix por cobrança recebida', basisPoints: 0, fixedCents: 199, fee: 'R$ 1,99' }],
  },
  {
    method: 'credit_card',
    label: 'Cartão de crédito',
    instruction: 'O cliente pode pagar à vista ou parcelar até o limite da loja. As opções dependem do valor da compra e do cartão.',
    receipt: 'Até 32 dias à vista. No parcelado, uma parcela a cada 32 dias, sem antecipação.',

  },
] as const;

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function StorePaymentSettings({ business, onSave }: { business: Business; onSave: (business: Business) => void }) {
  const saved = business.payment_methods ?? ['pix', 'credit_card'];
  const [methods, setMethods] = useState<StorePaymentMethod[]>(() => [...saved]);
  const savedLimit = business.max_card_installments ?? DEFAULT_CARD_INSTALLMENTS;
  const [maxCardInstallments, setMaxCardInstallments] = useState(savedLimit);
  const cardRates = Array.from({ length: maxCardInstallments }, (_, index) => {
    const count = index + 1;
    const basisPoints = count === 1 ? 299 : count <= 6 ? 349 : 399;
    return {
      label: count === 1 ? 'À vista (1×)' : count + '×',
      basisPoints,
      fixedCents: 49,
      fee: (basisPoints / 100).toLocaleString('pt-BR') + '% + R$ 0,49',
    };
  });
  const [saleAmount, setSaleAmount] = useState('100');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useFeedback();
  const grossCents = Math.round(Number(saleAmount) * 100);
  const validAmount = saleAmount !== '' && Number.isSafeInteger(grossCents) && grossCents >= 1 && grossCents <= 100000000;
  const changed = methods.length !== saved.length || methods.some((method) => !saved.includes(method)) || maxCardInstallments !== savedLimit;

  function toggle(method: StorePaymentMethod) {
    setMethods((current) => current.includes(method) ? current.filter((value) => value !== method) : [...current, method]);
    setError('');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !methods.length || !changed) return;
    setSaving(true);
    setError('');
    try {
      onSave(await updateBusiness(business.id, { payment_methods: methods, max_card_installments: maxCardInstallments }));
      showToast('Formas de pagamento atualizadas.');
    } catch (err: unknown) {
      setError(axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error : 'Não foi possível salvar as formas de pagamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="business-info store-payment-settings" aria-labelledby="store-payment-heading">
      <h2 id="store-payment-heading">Formas de pagamento</h2>
      <p>Escolha quais meios de pagamento seus clientes podem usar nesta loja.</p>
      <div className="form-group payment-simulation">
        <label htmlFor="payment-simulation-amount">Valor da venda para simular (R$)</label>
        <input id="payment-simulation-amount" type="number" min="0.01" max="1000000" step="0.01"
          value={saleAmount} onChange={(event) => setSaleAmount(event.target.value)} />
      </div>
      <form onSubmit={save}>
        <div className="payment-method-grid card-grid card-grid-6">
          {paymentOptions.map(({ method, label, instruction, receipt, ...option }) => (
            <article key={method} className="payment-method-card card-layout">
              <h3 className="card-row-1">{label}</h3>
              <p className="card-row-2">{instruction}</p>
              <p className="card-row-3">{receipt}</p>
              {method === 'credit_card' && (
                <div className="form-group card-row-4">
                  <label htmlFor="max-card-installments">Máximo de parcelas no cartão</label>
                  <select id="max-card-installments" value={maxCardInstallments}
                    disabled={saving || !methods.includes('credit_card')} onChange={(event) => {
                      setMaxCardInstallments(Number(event.target.value));
                      setError('');
                    }}>
                    {Array.from({ length: MAX_CARD_INSTALLMENTS }, (_, index) => (
                      <option key={index + 1} value={index + 1}>{index === 0 ? 'Somente à vista (1×)' : 'Até ' + (index + 1) + '×'}</option>
                    ))}
                  </select>
                </div>
              )}
              <dl
                className={method === 'credit_card' ? 'card-row-5 installment-simulation' : 'card-row-5'}
                tabIndex={method === 'credit_card' && maxCardInstallments > 3 ? 0 : undefined}
                aria-label={method === 'credit_card' ? 'Simulação das parcelas do cartão' : undefined}
              >
                {('rates' in option && option.rates ? option.rates : cardRates).map(({ label: rateLabel, fee, basisPoints, fixedCents }) => {
                  const feeCents = Math.round(grossCents * basisPoints / 10000) + fixedCents;
                  const net = validAmount && grossCents >= feeCents ? money.format((grossCents - feeCents) / 100) : '—';
                  return (
                    <div key={rateLabel}>
                      <dt>{rateLabel}</dt>
                      <dd>{fee} · Custo estimado {validAmount ? money.format(feeCents / 100) : '—'} · <strong>Líquido {net}</strong></dd>
                    </div>
                  );
                })}
              </dl>
              <label className="card-footer card-row-6">
                <input type="checkbox" checked={methods.includes(method)} disabled={saving} onChange={() => toggle(method)} />
                Aceitar {method === 'pix' ? label : 'cartão de crédito'}
              </label>
            </article>
          ))}
        </div>
        <p>Simulação com as tarifas públicas padrão do Asaas. As condições da conta podem variar. O líquido estimado é da cobrança na conta Asaas da plataforma, antes de antecipação, outros custos e eventuais repasses à loja.</p>
        <p><a href="https://www.asaas.com/precos-e-taxas" target="_blank" rel="noreferrer">Consultar preços e taxas do Asaas</a></p>
        {!methods.length && <p role="alert">Mantenha pelo menos uma forma de pagamento ativa.</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" disabled={saving || !methods.length || !changed}>
          {saving ? 'Salvando…' : 'Salvar formas de pagamento'}
        </button>
      </form>
    </section>
  );
}
