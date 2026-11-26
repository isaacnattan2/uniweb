import { AuthBrand } from '../components/AuthBrand';
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginUser } from '../services/api';
import { useAuthStore } from '../context/store';
import '../styles/auth.css';

export function LoginPage({ driver = false }: { driver?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [wrongEntry, setWrongEntry] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setWrongEntry(false);
    setLoading(true);

    try {
      const { user, token } = await loginUser(email, password);
      if ((user.user_type === 'driver') !== driver) {
        setWrongEntry(true);
        return;
      }
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
        <AuthBrand />
        
        <form onSubmit={handleLogin}>
          {error && <div className="error-message" role="alert">{error}</div>}
          {wrongEntry && <div className="error-message" role="alert">
            <Link to={driver ? '/login' : '/login/driver'}>Entrar pelo acesso {driver ? 'principal' : 'de entregador'}</Link>
          </div>}
          
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

        <p className="register-link">
          <Link to={driver ? '/register/driver' : '/register'} state={location.state}>Cadastrar</Link>
        </p>
      </div>
    </div>
  );
}
