import { AdminSplitOperations } from './AdminSplitOperations';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { getAsaasSimulationFees, type AsaasSimulationFees, type PaymentSplitDraft, type SavedPaymentSplit } from '../services/api';
import '../styles/business.css';
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

function promotionDate(value: string) {
  const date = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return date ? [date[3], date[2], date[1]].join('/') : value;
}

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
  const [search] = useSearchParams();
  const initialStore = search.get('loja') ?? '';
  const initialMethod = search.get('pagamento') === 'pix' ? 'pix' : 'credit_card';
  const [fields, setFields] = useState(defaults);
  const [method, setMethod] = useState<Method>(initialMethod === 'pix' ? 'pix' : 'card');
  const [installments, setInstallments] = useState(1);
  const [mode, setMode] = useState<Mode>('fixed');
  const [feeOwner, setFeeOwner] = useState('proportional');
  const [discountOwner, setDiscountOwner] = useState('store');
  const [commissionBase, setCommissionBase] = useState('net');
  const [fixedFeeUnit, setFixedFeeUnit] = useState('charge');
  const [fees, setFees] = useState<AsaasSimulationFees>();
  const [manualFees, setManualFees] = useState(false);
  const [feeError, setFeeError] = useState('');
  const [feeRevision, setFeeRevision] = useState(0);
  const loadCondition = useCallback((condition: SavedPaymentSplit, savedMethod: PaymentSplitDraft['method']) => {
    setMethod(savedMethod === 'pix' ? 'pix' : 'card');
    setInstallments(condition.maxInstallments ?? 1);
    setMode(condition.mode);
    setFeeOwner(condition.feeOwner);
    setDiscountOwner(condition.discountOwner);
    setCommissionBase(condition.commissionBase);
    setFixedFeeUnit(condition.manualFixedPerInstallment === undefined ? 'charge' : 'installment');
    setManualFees(condition.feeSource === 'manual');
    setFields((current) => ({
      ...current, asaasRate: String(condition.asaasRate), asaasFixed: String(condition.manualFixedPerInstallment ?? condition.asaasFixed),
      commissionRate: String(condition.commissionRate), commissionFixed: String(condition.commissionFixed),
      fixedOverride: condition.fixedOverride === null ? '' : String(condition.fixedOverride),
      rateOverride: condition.rateOverride === null ? '' : String(condition.rateOverride),
      actualFee: '',
    }));
  }, []);

  const count = method === 'pix' ? 1 : installments;
  const eligibleBands = fees?.creditCard.bands.filter(({ min }) => min <= count) ?? [];
  const cardBand = eligibleBands.reduce<AsaasSimulationFees['creditCard']['bands'][number] | undefined>(
    (previous, band) => !previous || band.rate > previous.rate ? band : previous, undefined);
  const completeCardFees = Array.from({ length: count }, (_, index) => index + 1)
    .every((installment) => eligibleBands.some(({ min, max }) => installment >= min && installment <= max));
  const accountFee = method === 'pix' ? fees?.pix : completeCardFees ? cardBand : undefined;
  const maxInstallments = Math.max(12, ...(fees?.creditCard.bands.map(({ max }) => max) ?? []));
  const missingFee = !manualFees && !accountFee;
  const selectedRate = manualFees ? Number(fields.asaasRate) : accountFee?.rate ?? 0;
  const selectedFixed = manualFees ? cents(fields.asaasFixed) : Math.round((accountFee?.fixed ?? 0) * 100);
  const pixMinimum = !manualFees && method === 'pix' ? fees?.pix?.minimum : null;
  const pixMaximum = !manualFees && method === 'pix' ? fees?.pix?.maximum : null;

  useEffect(() => {
    const request = new AbortController();
    setFees(undefined);
    setFeeError('');
    getAsaasSimulationFees(request.signal).then((result) => {
      if (!request.signal.aborted) setFees(result);
    }).catch((error: unknown) => {
      if (request.signal.aborted) return;
      setFeeError(axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
        ? error.response.data.error : 'Não foi possível consultar as tarifas da conta Asaas.');
    });
    return () => request.abort();
  }, [feeRevision]);

  const product = cents(fields.product);
  const discount = cents(fields.discount);
  const freight = cents(fields.freight);
  const driver = cents(fields.driver);
  const extra = cents(fields.chargeExtra);
  const merchandisePaid = product - discount;
  const charge = merchandisePaid + freight + extra;
  const feeBeforeLimits = percentOf(charge, selectedRate)
    + selectedFixed * (manualFees && fixedFeeUnit === 'installment' ? count : 1);
  const estimatedFee = Math.min(pixMaximum == null ? Infinity : Math.round(pixMaximum * 100),
    Math.max(pixMinimum == null ? 0 : Math.round(pixMinimum * 100), feeBeforeLimits));
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
  const error = missingFee ? 'Selecione uma tarifa disponível da conta ou informe uma tarifa manual para simular.'
    : invalidInput ? 'Confira os valores. O desconto deve caber no valor dos produtos e as taxas percentuais devem ficar entre 0% e 100%.'
    : charge <= 0 ? 'Informe um total de cobrança maior que zero.'
    : estimatedNet < 0 || actualNet < 0 ? 'A tarifa do Asaas ultrapassa o total da cobrança.' : null;

  const applyRequirements = [
    invalidInput && 'Revise os valores do pedido. O desconto não pode exceder o valor dos produtos e as taxas devem ficar entre 0% e 100%.',
    charge <= 0 && 'Informe um total de cobrança maior que zero.',
    extra !== 0 && 'Zere o acréscimo no pagamento. Ele pode ser simulado, mas ainda não é aplicado no checkout.',
    !manualFees && !fees && (feeError
      ? 'Atualize as tarifas do Asaas ou selecione Informar manualmente.'
      : 'Aguarde a consulta das tarifas da conta Asaas.'),
    !manualFees && fees?.environment === 'production' && 'A aplicação de condições está disponível no Asaas Sandbox.',
    Math.abs(Number(fields.commissionRate) * 100 - Math.round(Number(fields.commissionRate) * 100)) > 0.00001 &&
      'Use até duas casas decimais na comissão do Uniweb para salvar a taxa da plataforma.',
    Number(fields.rateOverride) > 100 && 'O percentual de split informado deve ficar entre 0% e 100%.',
    method === 'pix' && !invalidInput && charge > 0 && (
      (fees && !manualFees && !accountFee && 'A conta Asaas não informou a tarifa Pix. Atualize as tarifas ou informe uma manualmente.') ||
      (!missingFee && (estimatedNet < 0 || actualNet < 0) && 'A tarifa Asaas precisa caber no total cobrado.') ||
      (!error && (mode === 'fixed' ? fixedStore < 0 || fixedStore + driver > actualNet
        : splitRate < 0 || splitRate > 100 || percentOf(actualNet, splitRate) + driver > actualNet) &&
        'Ajuste o split e o ganho do entregador para que ambos caibam no líquido do pedido.')
    ),
  ].filter((value): value is string => typeof value === 'string');

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
      <h2 id="split-heading">Pagamentos e repasses</h2>
      <p>A simulação usa as tarifas da conta Asaas e as regras comerciais que você informar. Alterar os campos apenas recalcula a simulação.</p>
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
              {Array.from({ length: maxInstallments }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}x{index === 0 ? ' à vista' : index >= 12 ? ' · só simulação' : ''}</option>)}
            </select>
          </label>}
        </fieldset>
        <fieldset>
          <legend>Tarifas e comissão</legend>
          <label className="split-field">Origem da tarifa Asaas
            <select value={manualFees ? 'manual' : 'account'} onChange={(event) => setManualFees(event.target.value === 'manual')}>
              <option value="account">Conta Asaas</option><option value="manual">Informar manualmente</option>
            </select>
          </label>
          {!manualFees && (
            <div className="split-asaas-fees">
              {feeError ? <p role="status">{feeError}</p> : !fees ? <p role="status">Consultando tarifas do Asaas…</p> : (
                <>
                  <p><strong>Asaas {fees.environment === 'sandbox' ? 'Sandbox' : 'Produção'}</strong> · {new Date(fees.fetchedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
                  {accountFee ? (
                    <>
                      <p>Tarifa usada <strong>{percentage.format(selectedRate)}% + {money(selectedFixed)}</strong> por cobrança.</p>
                      {accountFee.promotionExpiresAt && <p>Condição promocional até {promotionDate(accountFee.promotionExpiresAt)}.</p>}
                      {method === 'card' && count > 1 && <p>Estimativa pela maior tarifa entre 1x e {count}x. O cliente escolhe as parcelas no Asaas.</p>}
                      {method === 'card' && fees.creditCard.daysToReceive !== null && (
                        <p>Prazo informado pelo Asaas: {fees.creditCard.daysToReceive} dias{count > 1 ? ' para cada parcela' : ''}.</p>
                      )}
                      {method === 'pix' && (pixMinimum != null || pixMaximum != null) && (
                        <p>Limites da tarifa: {pixMinimum != null && 'mínimo ' + money(Math.round(pixMinimum * 100))}
                          {pixMinimum != null && pixMaximum != null && ' · '}
                          {pixMaximum != null && 'máximo ' + money(Math.round(pixMaximum * 100))}.</p>
                      )}
                    </>
                  ) : <p>O Asaas não retornou uma tarifa para esta condição.</p>}
                  <details>
                    <summary>Ver tarifas retornadas pela conta</summary>
                    <ul>
                      {fees.pix && <li>Pix · {percentage.format(fees.pix.rate)}% + {money(Math.round(fees.pix.fixed * 100))}
                        {fees.pix.promotionExpiresAt && fees.pix.standardFixed !== null && ' (fixa padrão ' + money(Math.round(fees.pix.standardFixed * 100)) + ')'}</li>}
                      {fees.creditCard.bands.map((band) => (
                        <li key={band.min}>Cartão {band.min === band.max ? band.min + 'x' : band.min + 'x a ' + band.max + 'x'} · {percentage.format(band.rate)}% + {money(Math.round(band.fixed * 100))}
                          {band.promotionExpiresAt && band.standardRate !== null && ' (percentual padrão ' + percentage.format(band.standardRate) + '%)'}</li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
              <button type="button" className="btn-secondary" disabled={!fees && !feeError}
                onClick={() => setFeeRevision((value) => value + 1)}>Atualizar tarifas</button>
            </div>
          )}
          {manualFees && (
            <>
              {field('asaasRate', 'Tarifa Asaas (%)', { max: 100, step: '0.0001', hint: 'Incide sobre o total cobrado, incluindo frete e acréscimos.' })}
              {field('asaasFixed', 'Tarifa fixa Asaas (R$)')}
              {count > 1 && <label className="split-field">Aplicação da tarifa fixa
                <select value={fixedFeeUnit} onChange={(event) => setFixedFeeUnit(event.target.value)}>
                  <option value="charge">Uma vez na cobrança</option><option value="installment">Uma vez por parcela</option>
                </select>
              </label>}
            </>
          )}
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
      <AdminSplitOperations initialStore={initialStore} initialMethod={initialMethod} onLoadCondition={loadCondition}
        requirements={applyRequirements}
        accountCardBands={manualFees ? undefined : fees?.creditCard.bands}
        draft={{
          method: method === 'pix' ? 'pix' : 'credit_card', maxInstallments: count,
          mode, feeOwner, discountOwner, commissionBase,
          commissionRate: Number(fields.commissionRate), commissionFixed: Number(fields.commissionFixed),
          feeSource: manualFees ? 'manual' : 'account', asaasRate: selectedRate, asaasFixed: selectedFixed / 100,
          fixedFeePerInstallment: manualFees && fixedFeeUnit === 'installment',
          asaasMinimum: pixMinimum ?? null, asaasMaximum: pixMaximum ?? null,
          fixedOverride: fields.fixedOverride === '' ? null : Number(fields.fixedOverride),
          rateOverride: fields.rateOverride === '' ? null : Number(fields.rateOverride),
        }} />
    </section>
  );
}
