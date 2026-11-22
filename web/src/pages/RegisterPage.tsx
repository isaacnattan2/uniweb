import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { registerUser } from '../services/api';
import { useAuthStore } from '../context/store';
import { CheckoutAddress, emptyDeliveryAddress, isDeliveryAddressComplete } from '../components/CheckoutAddress';
import '../styles/auth.css';

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
  });
  const [addAddress, setAddAddress] = useState(false);
  const [address, setAddress] = useState(emptyDeliveryAddress);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (addAddress && !isDeliveryAddressComplete(address)) {
      setError('Informe CEP, logradouro, número, cidade e UF para salvar seu endereço.');
      return;
    }
    setLoading(true);

    try {
      const { user, token } = await registerUser(formData.email, formData.password, formData.fullName, 'customer', addAddress ? address : undefined, formData.phone);
      login(token, user.id, user.user_type);
      navigate(location.state?.from === '/cart' ? '/cart' : '/shop', { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível criar sua conta.');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>🛍️ Criar conta de cliente</h1>
        <p>Cadastre-se para comprar no marketplace</p>
        
        <form onSubmit={handleRegister}>
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="fullName">Nome Completo</label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="Seu nome"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">Telefone (opcional)</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              value={formData.phone}
              onChange={handleChange}
              placeholder="(11) 9999-9999"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Mínimo 6 caracteres"
              required
            />
          </div>

          <label className="auth-address-toggle">
            <input type="checkbox" checked={addAddress} disabled={loading} onChange={(event) => setAddAddress(event.target.checked)} />
            Cadastrar endereço de entrega (opcional)
          </label>
          {addAddress && <CheckoutAddress address={address} onChange={setAddress} disabled={loading} />}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Criando conta...' : 'Criar Conta'}
          </button>
        </form>

        <p className="register-link"><Link to="/register/driver">Cadastrar como entregador</Link></p>
        <p className="register-link">
          Já tem conta? <Link to="/login" state={location.state}>Fazer login</Link>
        </p>
      </div>
    </div>
  );
}
