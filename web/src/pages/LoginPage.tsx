import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginUser } from '../services/api';
import { useAuthStore } from '../context/store';
import '../styles/auth.css';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { user, token } = await loginUser(email, password);
      login(token, user.id, user.user_type);
      const from = location.state?.from;
      const customerDestination = typeof from === 'string' && (from === '/cart' ||
        /^\/store\/[\da-f-]{36}(?:\?product=[\da-f-]{36})?$/i.test(from) ||
        /^\/order\/[\da-f-]{36}$/i.test(from)) ? from : '/shop';
      const storeDestination = typeof from === 'string' && /^\/business\/[\da-f-]{36}\?order=[\da-f-]{36}$/i.test(from) ? from : '/dashboard';
      navigate(user.user_type === 'admin' ? '/admin' : user.user_type === 'business' ? storeDestination :
        user.user_type === 'driver' ? '/driver' : customerDestination, { replace: true });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível entrar. Verifique seus dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>🛍️ Entrar na Uniweb</h1>
        <p>Acesso de clientes, lojistas, entregadores e administradores</p>
        
        <form onSubmit={handleLogin}>
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="register-link"><Link to="/register/driver">Cadastrar como entregador</Link></p>
        <p className="register-link">
          Não tem conta? <Link to="/register" state={location.state}>Criar conta</Link>
        </p>
      </div>
    </div>
  );
}
