import { PasswordFields } from '../components/PasswordFields';
import { validatePasswordConfirmation } from '../utils/passwordPolicy';
import { AuthBrand } from '../components/AuthBrand';
import { StoreWithdrawals } from '../components/StoreWithdrawals';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { getDriverRegistration, registerDriver } from '../services/api';
import type { DriverRegistration, DriverRegistrationInput } from '../services/api';
import { useAuthStore } from '../context/store';
import '../styles/auth.css';
import '../styles/driver.css';
import '../styles/business.css';

const vehicles: Record<string, string> = {
  bicycle: 'Bicicleta',
  motorcycle: 'Moto',
  car: 'Carro',
  utility: 'Utilitário',
  van: 'Minivan',
  truck: 'Caminhão',
};

const emptyForm: DriverRegistrationInput = {
  fullName: '', email: '', phone: '', cpf: '', password: '',
  vehicleType: '', manufacturer: '', brand: '', color: '', plate: '',
};

const fields = [
  { name: 'fullName', label: 'Nome completo', maxLength: 255, autoComplete: 'name' },
  { name: 'email', label: 'E-mail', type: 'email', maxLength: 255, autoComplete: 'email' },
  { name: 'phone', label: 'Telefone com DDD', type: 'tel', maxLength: 20, autoComplete: 'tel' },
  { name: 'cpf', label: 'CPF', maxLength: 14, inputMode: 'numeric' },
] as const;

export function DriverRegisterPage() {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const [form, setForm] = useState(emptyForm);
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    const passwordError = validatePasswordConfirmation(form.password, confirmation);
    if (passwordError) { setError(passwordError); return; }
    setLoading(true);
    setError('');
    try {
      const { user, token } = await registerDriver(form);
      login(token, user.id, user.user_type);
      navigate('/driver', { replace: true });
    } catch (err) {
      setError(axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error : 'Não foi possível concluir o cadastro.');
    } finally {
      setLoading(false);
    }
  }

  function change(name: keyof DriverRegistrationInput, value: string) {
    setForm((previous) => ({ ...previous, [name]: name === 'plate' ? value.toUpperCase() : value }));
  }

  return (
    <main className="auth-container">
      <div className="auth-box driver-register">
        <AuthBrand />
        <p>Cadastro de entregador</p>
        <form onSubmit={submit}>
          <fieldset disabled={loading}>
            <legend>Dados pessoais</legend>
            <div className="driver-fields">
              {fields.map(({ name, label, ...attributes }) => (
                <div className="form-group" key={name}>
                  <label htmlFor={'driver-' + name}>{label}</label>
                  <input id={'driver-' + name} {...attributes} value={form[name]} required
                    onChange={(event) => change(name, event.target.value)} />
                </div>
              ))}
              <PasswordFields password={form.password} confirmation={confirmation}
                onPassword={(value) => change('password', value)} onConfirmation={setConfirmation} />
            </div>
          </fieldset>
          <fieldset disabled={loading}>
            <legend>Veículo</legend>
            <div className="driver-fields">
              <div className="form-group">
                <label htmlFor="driver-vehicle">Tipo de veículo</label>
                <select id="driver-vehicle" value={form.vehicleType} required
                  onChange={(event) => change('vehicleType', event.target.value)}>
                  <option value="">Selecione o veículo</option>
                  {Object.entries(vehicles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              {([
                ['manufacturer', 'Fabricante', 100], ['brand', 'Marca', 100], ['color', 'Cor', 50],
                ['plate', form.vehicleType === 'bicycle' ? 'Placa (opcional)' : 'Placa', 10],
              ] as const).map(([name, label, maxLength]) => (
                <div className="form-group" key={name}>
                  <label htmlFor={'driver-' + name}>{label}</label>
                  <input id={'driver-' + name} maxLength={maxLength} value={form[name]}
                    required={name !== 'plate' || form.vehicleType !== 'bicycle'} onChange={(event) => change(name, event.target.value)} />
                </div>
              ))}
            </div>
          </fieldset>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Cadastrando…' : 'Criar conta de entregador'}</button>
        </form>
        <p className="register-link">Já tem conta? <Link to="/login/driver">Fazer login</Link></p>
      </div>
    </main>
  );
}

export function DriverPage() {
  const [search] = useSearchParams();
  const section = search.get('aba');
  const [data, setData] = useState<DriverRegistration>();
  const [error, setError] = useState('');
  useEffect(() => {
    const request = new AbortController();
    getDriverRegistration(request.signal).then((profile) => {
      if (!request.signal.aborted) setData(profile);
    }).catch((err) => {
      if (!request.signal.aborted) setError(axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error : 'Não foi possível carregar seu cadastro.');
    });
    return () => request.abort();
  }, []);

  return (
    <main className="driver-page">
      <div className="container">
        <h1>Meu cadastro de entregador</h1>
        {error ? <p role="alert">{error}</p> : !data ? <p role="status">Carregando cadastro…</p> : (
          <>
            {section !== 'saques' && <div className="driver-fields">
              <section className="driver-profile-details">
                <h2>Dados pessoais</h2>
                <dl>
                  <dt>Nome</dt><dd>{data.full_name}</dd>
                  <dt>E-mail</dt><dd>{data.email}</dd>
                  <dt>Telefone</dt><dd>{data.phone}</dd>
                </dl>
              </section>
              <section className="driver-profile-details">
                <h2>Veículo</h2>
                <dl>
                  <dt>Tipo</dt><dd>{vehicles[data.vehicle_type] || data.vehicle_type}</dd>
                  <dt>Fabricante</dt><dd>{data.vehicle_manufacturer || '—'}</dd>
                  <dt>Marca</dt><dd>{data.vehicle_brand || '—'}</dd>
                  <dt>Cor</dt><dd>{data.vehicle_color || '—'}</dd>
                  {data.vehicle_plate && <><dt>Placa</dt><dd>{data.vehicle_plate}</dd></>}
                </dl>
              </section>
            </div>}
          </>
        )}
        {data && section === 'saques' && <StoreWithdrawals />}
      </div>
    </main>
  );
}
