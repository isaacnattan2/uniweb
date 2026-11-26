import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { deleteCustomerCard, getCustomerCards, saveCustomerCard, type SavedCustomerCard } from '../services/api';

export function SavedCardForm({ onSaved, onCancel }: { onSaved: (card: SavedCustomerCard) => void; onCancel: () => void }) {
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const field = (key: string) => String(fields.get(key) ?? '');
    if (fields.get('consent') !== 'on') return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await saveCustomerCard({
        holderName: field('holderName'), number: field('number'), expiryMonth: field('expiryMonth'),
        expiryYear: field('expiryYear'), ccv: field('ccv'), cpfCnpj: field('cpfCnpj'), postalCode: field('postalCode'),
        addressNumber: field('addressNumber'), phone: field('phone'), consent: true,
      });
      form.reset();
      onSaved(saved);
    } catch (err) {
      const ccv = form.elements.namedItem('ccv') as HTMLInputElement | null;
      if (ccv) ccv.value = '';
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o cartão.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function fillTestCard() {
    const form = formRef.current;
    if (!form) return;
    const example = {
      holderName: 'Uniweb Teste Cartao', number: '4444 4444 4444 4444',
      expiryMonth: '12', expiryYear: String(new Date().getFullYear() + 2), ccv: '123',
      cpfCnpj: '24971563792', postalCode: '89223005', addressNumber: '277', phone: '4738010919',
    };
    form.reset();
    for (const [name, value] of Object.entries(example)) {
      const input = form.elements.namedItem(name);
      if (input instanceof HTMLInputElement) input.value = value;
    }
    setError('');
  }

  const fields = [
    ['holderName', 'Nome do titular', 120, false],
    ['number', 'Número do cartão de teste', 23, true],
    ['expiryMonth', 'Mês da validade', 2, true],
    ['expiryYear', 'Ano da validade (AAAA)', 4, true],
    ['ccv', 'Código de segurança', 4, true],
    ['cpfCnpj', 'CPF ou CNPJ do titular', 18, true],
    ['postalCode', 'CEP de cobrança', 9, true],
    ['addressNumber', 'Número do endereço', 20, false],
    ['phone', 'Telefone com DDD', 16, true],
  ] as const;

  return (
    <form ref={formRef} onSubmit={(event) => void submit(event)} autoComplete="off">
      <p><strong>Sandbox Asaas.</strong> Use um cartão de teste e dados fictícios. Salvar o cartão não gera cobrança.</p>
      <button type="button" className="btn-secondary" disabled={saving} onClick={fillTestCard}>
        Preencher cartão de teste
      </button>
      <fieldset disabled={saving}>
        {fields.map(([name, label, maxLength, numeric]) => (
          <div className="form-group" key={name}>
            <label htmlFor={prefix + name}>{label}</label>
            <input id={prefix + name} name={name} maxLength={maxLength} inputMode={numeric ? 'numeric' : 'text'}
              type={name === 'ccv' ? 'password' : 'text'} required />
          </div>
        ))}
        <label><input type="checkbox" name="consent" required /> Quero salvar este cartão de teste para compras futuras.</label>
      </fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="card-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar cartão'}</button>
      </div>
    </form>
  );
}

export function cardLabel(card: SavedCustomerCard) {
  return `${card.brand} •••• ${card.lastFour}`;
}

export function CustomerSavedCards() {
  const [data, setData] = useState<{ enabled: boolean; cards: SavedCustomerCard[] }>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => {
    const request = new AbortController();
    void getCustomerCards(request.signal).then((value) => {
      if (!request.signal.aborted) setData(value);
    }).catch(() => {
      if (!request.signal.aborted) setError('Não foi possível carregar seus cartões.');
    });
    return () => request.abort();
  }, []);

  async function remove(id: string) {
    if (removing) return;
    setRemoving(id);
    setError('');
    try {
      await deleteCustomerCard(id);
      setData((old) => old && { ...old, cards: old.cards.filter((card) => card.id !== id) });
    } catch {
      setError('Não foi possível remover o cartão.');
    } finally { setRemoving(undefined); }
  }

  return (
    <section aria-labelledby="saved-cards-heading">
      <h2 id="saved-cards-heading">Meus cartões</h2>
      {error && <p role="alert" className="error-message">{error}</p>}
      {!data && !error && <p role="status">Carregando cartões…</p>}
      {data && !data.enabled && <p>Cadastro de cartões de teste indisponível.</p>}
      {data?.enabled && <>
        {data.cards.length ? <ul>{data.cards.map((card) => <li key={card.id}>
          <span>{cardLabel(card)}</span>{' '}
          <button type="button" className="btn-secondary" disabled={Boolean(removing)}
            aria-label={`Remover ${cardLabel(card)}`} onClick={() => void remove(card.id)}>Remover</button>
        </li>)}</ul> : <p>Nenhum cartão salvo.</p>}
        {adding ? <SavedCardForm onCancel={() => setAdding(false)} onSaved={(card) => {
          setData({ ...data, cards: [card, ...data.cards] });
          setAdding(false);
        }} /> : <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Adicionar cartão</button>}
      </>}
    </section>
  );
}
