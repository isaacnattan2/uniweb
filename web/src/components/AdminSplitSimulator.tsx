import { useState } from 'react';
import '../styles/split-simulator.css';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const percentage = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const money = (cents: number) => currency.format(cents / 100);
const cents = (value: string) => Math.round(Number(value) * 100);
const percentOf = (amount: number, rate: number) => Math.round(amount * rate / 100);
const defaults = {
  product: '100', discount: '0', freight: '25', driver: '25', asaasRate: '4', asaasFixed: '0',
  commissionRate: '12', commissionFixed: '0', chargeExtra: '0', actualFee: '', fixedOverride: '', rateOverride: '',
};
type Field = keyof typeof defaults;
type Method = 'pix' | 'card';
type Mode = 'fixed' | 'percentage';

function NumberField({ label, value, onChange, max, step = '0.01', hint }: {
  label: string; value: string; onChange: (value: string) => void; max?: number; step?: string; hint?: string;
}) {
  return (
    <label className="split-field">
      <span>{label}</span>
      <input type="number" min="0" max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function AdminSplitSimulator() {
  const [fields, setFields] = useState(defaults);
  const [method, setMethod] = useState<Method>('card');
  const [installments, setInstallments] = useState(1);
  const [mode, setMode] = useState<Mode>('fixed');
  const [feeOwner, setFeeOwner] = useState('proportional');
  const [discountOwner, setDiscountOwner] = useState('store');
  const [commissionBase, setCommissionBase] = useState('net');
  const [fixedFeeUnit, setFixedFeeUnit] = useState('charge');
  const count = method === 'pix' ? 1 : installments;

  const product = cents(fields.product);
  const discount = cents(fields.discount);
  const freight = cents(fields.freight);
  const driver = cents(fields.driver);
  const extra = cents(fields.chargeExtra);
  const merchandisePaid = product - discount;
  const charge = merchandisePaid + freight + extra;
  const estimatedFee = percentOf(charge, Number(fields.asaasRate))
    + cents(fields.asaasFixed) * (fixedFeeUnit === 'installment' ? count : 1);
  const actualFee = fields.actualFee === '' ? estimatedFee : cents(fields.actualFee);
  const estimatedNet = charge - estimatedFee;
  const actualNet = charge - actualFee;
  const storeProcessing = feeOwner === 'store' ? estimatedFee
    : feeOwner === 'proportional' && charge > 0 ? Math.round(estimatedFee * merchandisePaid / charge) : 0;
  const storeBase = discountOwner === 'store' ? merchandisePaid : product;
  const commissionValue = commissionBase === 'net' ? Math.max(0, storeBase - storeProcessing) : storeBase;
  const commission = percentOf(commissionValue, Number(fields.commissionRate)) + cents(fields.commissionFixed);
  const estimatedStore = storeBase - storeProcessing - commission;
  const fixedStore = fields.fixedOverride === '' ? estimatedStore : cents(fields.fixedOverride);
  const splitRate = fields.rateOverride === ''
    ? estimatedNet > 0 ? Math.round(estimatedStore / estimatedNet * 1_000_000) / 10_000 : 0
    : Number(fields.rateOverride);

  const invalidInput = Object.values(fields).some((value) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1_000_000_000)
    || Number(fields.asaasRate) > 100 || Number(fields.commissionRate) > 100 || discount > product;
  const error = invalidInput ? 'Confira os valores. O desconto deve caber no valor dos produtos e as taxas percentuais devem ficar entre 0% e 100%.'
    : charge <= 0 ? 'Informe um total de cobrança maior que zero.'
    : estimatedNet < 0 || actualNet < 0 ? 'A tarifa do Asaas ultrapassa o total da cobrança.' : null;

  function field(name: Field, label: string, options: { max?: number; step?: string; hint?: string } = {}) {
    return <NumberField label={label} value={fields[name]} onChange={(value) => setFields((current) => ({ ...current, [name]: value }))} {...options} />;
  }

  const results = [
    { type: 'fixed' as const, title: 'Split fixo', store: fixedStore, validRate: true,
      rule: money(fixedStore) + ' definidos no checkout' },
    { type: 'percentage' as const, title: 'Split percentual', store: percentOf(actualNet, splitRate), validRate: splitRate >= 0 && splitRate <= 100,
      rule: percentage.format(splitRate) + '% sobre ' + money(actualNet) + ' líquidos' },
  ];

  return (
    <section className="split-simulator" aria-labelledby="split-heading">
      <h2 id="split-heading">Simulador de split</h2>
      <p>Os valores iniciais são hipotéticos. A simulação usa os números informados e não cria cobranças ou repasses.</p>
      <div className="split-inputs">
        <fieldset>
          <legend>Pedido e pagamento</legend>
          {field('product', 'Valor dos produtos (R$)')}
          {field('freight', 'Frete cobrado do cliente (R$)')}
          {field('driver', 'Valor a pagar ao entregador (R$)')}
          {field('discount', 'Desconto nos produtos (R$)')}
          <label className="split-field">Quem financia o desconto
            <select value={discountOwner} onChange={(event) => setDiscountOwner(event.target.value)}>
              <option value="store">Lojista</option><option value="platform">Uniweb</option>
            </select>
          </label>
          {field('chargeExtra', 'Acréscimo no pagamento (R$)', { hint: 'Valor cobrado do cliente e destinado ao Uniweb, como um acréscimo de parcelamento.' })}
          <label className="split-field">Forma de pagamento
            <select value={method} onChange={(event) => setMethod(event.target.value as Method)}>
              <option value="pix">Pix</option><option value="card">Cartão de crédito</option>
            </select>
          </label>
          {method === 'card' && <label className="split-field">Parcelas
            <select value={installments} onChange={(event) => setInstallments(Number(event.target.value))}>
              {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}x{index === 0 ? ' à vista' : ''}</option>)}
            </select>
          </label>}
        </fieldset>
        <fieldset>
          <legend>Tarifas e comissão</legend>
          {field('asaasRate', 'Tarifa Asaas (%)', { max: 100, step: '0.0001', hint: 'Incide sobre o total cobrado, incluindo frete e acréscimos.' })}
          {field('asaasFixed', 'Tarifa fixa Asaas (R$)')}
          {count > 1 && <label className="split-field">Aplicação da tarifa fixa
            <select value={fixedFeeUnit} onChange={(event) => setFixedFeeUnit(event.target.value)}>
              <option value="charge">Uma vez na cobrança</option><option value="installment">Uma vez por parcela</option>
            </select>
          </label>}
          <label className="split-field">Quem absorve a tarifa estimada
            <select value={feeOwner} onChange={(event) => setFeeOwner(event.target.value)}>
              <option value="proportional">Lojista pelos produtos, Uniweb pelo restante</option>
              <option value="store">Lojista absorve tudo</option><option value="platform">Uniweb absorve tudo</option>
            </select>
          </label>
          {field('commissionRate', 'Comissão Uniweb (%)', { max: 100, step: '0.0001' })}
          {field('commissionFixed', 'Comissão fixa Uniweb (R$)')}
          <label className="split-field">Base da comissão percentual
            <select value={commissionBase} onChange={(event) => setCommissionBase(event.target.value)}>
              <option value="net">Produtos após a parcela da tarifa Asaas</option>
              <option value="gross">Produtos antes da parcela da tarifa Asaas</option>
            </select>
          </label>
          {field('actualFee', 'Tarifa efetiva Asaas (R$)', { hint: 'Deixe em branco para usar a estimativa. Informe outro valor para simular divergência.' })}
        </fieldset>
        <fieldset>
          <legend>Regra de split</legend>
          <div className="split-mode">
            <label><input type="radio" name="simulator-split-mode" checked={mode === 'fixed'} onChange={() => setMode('fixed')} /> Fixo</label>
            <label><input type="radio" name="simulator-split-mode" checked={mode === 'percentage'} onChange={() => setMode('percentage')} /> Percentual</label>
          </div>
          {field('fixedOverride', 'Repasse fixo à loja (R$)', { hint: 'Em branco, usa o repasse calculado pela comissão e tarifa.' })}
          {field('rateOverride', 'Split percentual à loja (%)', { max: 100, step: '0.0001', hint: 'Em branco, converte o repasse calculado em percentual do líquido estimado.' })}
        </fieldset>
      </div>
      {error ? <p role="status" className="split-error">{error}</p> : (
        <>
          <dl className="split-summary">
            <div><dt>Cliente paga</dt><dd>{money(charge)} · {method === 'pix' ? 'Pix' : 'Cartão ' + count + 'x'}</dd></div>
            <div><dt>Tarifa Asaas estimada</dt><dd>{money(estimatedFee)}</dd></div>
            <div><dt>Líquido após tarifa efetiva</dt><dd>{money(actualNet)}</dd></div>
            <div><dt>Comissão Uniweb calculada</dt><dd>{money(commission)}</dd></div>
          </dl>
          <p>Base da loja {money(storeBase)} − parcela estimada do Asaas {money(storeProcessing)} − comissão {money(commission)} = <strong>{money(estimatedStore)} estimados para o lojista</strong>.</p>
          {driver > freight && <p>O pagamento ao entregador excede o frete cobrado em <strong>{money(driver - freight)}</strong>.</p>}
          <div className="split-results">
            {results.map(({ type, title, store, validRate, rule }) => {
              const validSplit = validRate && store >= 0 && store <= actualNet;
              const platform = actualNet - store - driver;
              return (
                <article key={type} className={mode === type ? 'split-result split-result-selected' : 'split-result'}>
                  <h3>{title}</h3>
                  <p>{rule}</p>
                  {validSplit ? (
                    <>
                      <table>
                        <thead><tr><th scope="col">Destino</th><th scope="col">Valor</th></tr></thead>
                        <tbody>
                          <tr><th scope="row">Asaas · processamento</th><td>{money(actualFee)}</td></tr>
                          <tr><th scope="row">Lojista · split da cobrança</th><td>{money(store)}</td></tr>
                          <tr><th scope="row">Entregador · repasse após entrega</th><td>{money(driver)}</td></tr>
                          <tr><th scope="row">Uniweb · saldo após o repasse</th><td>{money(platform)}</td></tr>
                        </tbody>
                        <tfoot><tr><th scope="row">Total pago</th><td>{money(charge)}</td></tr></tfoot>
                      </table>
                      {platform < 0 && <p className="split-error">O Uniweb teria de aportar {money(-platform)} para completar o repasse ao entregador.</p>}
                    </>
                  ) : <p className="split-error">Split inviável. O repasse precisa caber no líquido e o percentual deve ficar entre 0% e 100%.</p>}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}