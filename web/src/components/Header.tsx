import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore, useCartStore } from '../context/store';
import { getRideAppDownload } from '../services/api';
import '../styles/header.css';

export function Header({ compact = false, leading }: { compact?: boolean; leading?: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, userType, logout } = useAuthStore();
  const cartItems = useCartStore((state) => state.items);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register' || location.pathname === '/register/driver';
  const isShopper = !token || userType === 'customer';
  const showRideDownload = !isAuthPage && isShopper;
  const [rideApk, setRideApk] = useState<string | null>(null);
  const profileLabel = userType === 'admin' ? 'Admin' :
    userType === 'business' ? 'Lojista' :
    userType === 'customer' ? 'Cliente' :
    userType === 'driver' ? 'Entregador' : null;

  useEffect(() => {
    if (location.pathname === '/shop') {
      setSearch(new URLSearchParams(location.search).get('q') || '');
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!showRideDownload) return;
    const request = new AbortController();
    void getRideAppDownload(request.signal).then((url) => {
      if (!request.signal.aborted) setRideApk(url);
    }).catch(() => {
      if (!request.signal.aborted) setRideApk(null);
    });
    return () => request.abort();
  }, [showRideDownload, location.pathname]);

  function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    const term = search.trim();
    if (term.length < 2) {
      searchRef.current?.setCustomValidity('Digite pelo menos 2 caracteres para buscar.');
      searchRef.current?.reportValidity();
      return;
    }
    navigate(`/shop?q=${encodeURIComponent(term)}`);
  }

  const handleLogout = () => {
    logout();
    navigate(userType === 'driver' ? '/login/driver' : '/login');
  };

  const rideDownload = rideApk
    ? <a className="header-ride-download" href={rideApk}>Baixar UniCorrida</a>
    : <button className="header-ride-download" type="button" disabled title="APK ainda indisponível">Baixar UniCorrida</button>;

  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          {leading}
          <div className="header-brand">
            {!compact && (
              <Link to="/shop" className="logo">
                <img src="/unientregador-icon.png" width="32" height="32" alt="" />
                <span>UniWeb</span>
              </Link>
            )}
            {token && profileLabel && <span className="profile-label">{profileLabel}</span>}
          </div>

          {!isAuthPage && isShopper && (
            <form className="header-search" role="search" onSubmit={handleSearch}>
              <input ref={searchRef} aria-label="Buscar produtos" placeholder="Buscar produtos" value={search} onChange={(event) => { event.target.setCustomValidity(''); setSearch(event.target.value); }} minLength={2} required />
              <button type="submit">Buscar</button>
            </form>
          )}

          {!isAuthPage && isShopper && <nav className="nav" aria-label="Navegação principal">
            <Link to="/cart" className="nav-link">🛒 Carrinho ({cartItems.length})</Link>
            {token && (
              <>
                <Link to="/orders" className="nav-link">Pedidos</Link>
                <Link to="/account" className="nav-link">Minha conta</Link>
              </>
            )}
          </nav>}

          {!isAuthPage && <div className={compact ? "header-actions header-profile-actions" : "header-actions"}>
            {token && <div id="header-push-settings" />}
            {token ? (
              <>
                <button onClick={handleLogout} className="btn-logout">
                  Sair
                </button>
                {showRideDownload && rideDownload}
              </>
            ) : (
              <>
                <Link to="/login" className="btn-login">
                  Login
                </Link>
                <div className="header-registration-actions">
                  <Link to="/register" className="btn-register">
                    Registrar
                  </Link>
                  {rideDownload}
                </div>
              </>
            )}
          </div>}
        </div>
      </div>
    </header>
  );
}
