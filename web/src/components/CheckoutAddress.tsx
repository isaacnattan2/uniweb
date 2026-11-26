import React, { useEffect, useId, useRef, useState } from 'react';
import axios from 'axios';
import { lookupPostalCode } from '../services/api';
import type { DeliveryAddress } from '../services/api';
import '../styles/checkout-address.css';

export const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
export const emptyDeliveryAddress: DeliveryAddress = {
  cep: '', street: '', number: '', neighborhood: '', city: '', state: '', complement: '',
};

export function isDeliveryAddressComplete(address: DeliveryAddress) {
  return /^[0-9]{5}-[0-9]{3}$/.test(address.cep) && address.street.trim() && address.number.trim() &&
    address.city.trim() && states.includes(address.state);
}

export function CheckoutAddress({ address, onChange, disabled, title = 'Dados do endereço', description, requiredFields = [] }: {
  address: DeliveryAddress;
  onChange: React.Dispatch<React.SetStateAction<DeliveryAddress>>;
  disabled: boolean;
  title?: string;
  description?: string;
  requiredFields?: readonly (keyof DeliveryAddress)[];
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const streetInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => request.current?.abort(), []);

  function changeCep(value: string) {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 8);
    const cep = digits.length > 5 ? digits.slice(0, 5) + '-' + digits.slice(5) : digits;
    if (cep === address.cep) return;
    request.current?.abort();
    request.current = null;
    setPending(false);
    setNotice('');
    setError('');
    onChange({ ...emptyDeliveryAddress, cep });
  }

  async function searchCep() {
    const cep = address.cep.replace('-', '');
    if (pending || cep.length !== 8) return;
    const current = new AbortController();
    request.current = current;
    setPending(true);
    setNotice('');
    setError('');
    try {
      const result = await lookupPostalCode(cep, current.signal);
      if (current.signal.aborted) return;
      onChange((previous) => ({ ...previous, ...result, street: result.street || previous.street,
        neighborhood: result.neighborhood || previous.neighborhood }));
      setNotice(result.street ? 'Endereço encontrado. Confira os dados e informe o número.' :
        'Cidade e UF encontradas. Complete o logradouro e o número.');
    } catch (err) {
      if (current.signal.aborted) return;
      setError(axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error : 'Não foi possível consultar o CEP. Preencha o endereço manualmente.');
    } finally {
      if (!current.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  useEffect(() => {
    if (!pending && notice) {
      const target = address.street ? numberInput.current : streetInput.current;
      target?.focus();
    }
  }, [pending, notice]);

  function setField(field: keyof DeliveryAddress, value: string) {
    onChange((previous) => ({ ...previous, [field]: value }));
  }

  const lockFields = disabled || pending;
  return (
    <fieldset className="checkout-address" disabled={disabled}>
      <legend>{title}</legend>
      {description && <p>{description}</p>}
      <label htmlFor={id + '-cep'}>CEP</label>
      <div className="checkout-cep-row">
        <input id={id + '-cep'} autoComplete="shipping postal-code" inputMode="numeric" placeholder="00000-000" required={requiredFields.includes('cep')} pattern="[0-9]{5}-[0-9]{3}"
          value={address.cep} onChange={(event) => changeCep(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void searchCep();
            }
          }} />
        <button className="btn-secondary" type="button" disabled={pending || address.cep.length !== 9}
          onClick={() => void searchCep()}>{pending ? 'Buscando…' : 'Buscar CEP'}</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <label htmlFor={id + '-street'}>Logradouro</label>
      <input id={id + '-street'} ref={streetInput} autoComplete="shipping address-line1" maxLength={160}
        disabled={lockFields} required={requiredFields.includes('street')} value={address.street} onChange={(event) => setField('street', event.target.value)} />
      <div className="checkout-address-pair">
        <div>
          <label htmlFor={id + '-number'}>Número</label>
          <input id={id + '-number'} ref={numberInput} maxLength={30} placeholder="Ex.: 120 ou S/N"
            disabled={lockFields} required={requiredFields.includes('number')} value={address.number} onChange={(event) => setField('number', event.target.value)} />
        </div>
        <div>
          <label htmlFor={id + '-complement'}>Complemento</label>
          <input id={id + '-complement'} autoComplete="shipping address-line2" maxLength={120}
            disabled={lockFields} value={address.complement} onChange={(event) => setField('complement', event.target.value)} />
        </div>
      </div>
      <label htmlFor={id + '-neighborhood'}>Bairro</label>
      <input id={id + '-neighborhood'} autoComplete="shipping address-level3" maxLength={100}
        disabled={lockFields} required={requiredFields.includes('neighborhood')} value={address.neighborhood} onChange={(event) => setField('neighborhood', event.target.value)} />
      <div className="checkout-address-city">
        <div>
          <label htmlFor={id + '-city'}>Cidade</label>
          <input id={id + '-city'} autoComplete="shipping address-level2" maxLength={100}
            disabled={lockFields} value={address.city} onChange={(event) => setField('city', event.target.value)} />
        </div>
        <div>
          <label htmlFor={id + '-state'}>UF</label>
          <select id={id + '-state'} autoComplete="shipping address-level1"
            disabled={lockFields} value={address.state} onChange={(event) => setField('state', event.target.value)}>
            <option value="">UF</option>
            {states.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
        </div>
      </div>
    </fieldset>
  );
}
