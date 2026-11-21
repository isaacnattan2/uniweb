import React, { ReactNode, useEffect, useState } from 'react';
import axios from 'axios';
import { getCurrentUser } from '../services/api';
import { useAuthStore } from '../context/store';

export function SessionGate({ children }: { children: ReactNode }) {
  const { token, userType, login, logout } = useAuthStore();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!token || userType) return;
    let active = true;
    setError('');
    getCurrentUser().then((user) => {
      if (active) login(token, user.id, user.user_type);
    }).catch((err: unknown) => {
      if (!active) return;
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        logout();
      } else {
        console.error('Erro ao restaurar sessão:', err);
        setError('Não foi possível verificar a sessão. Confira a conexão com o servidor.');
      }
    });
    return () => { active = false; };
  }, [token, userType, login, logout, retry]);

  if (token && !userType) {
    return <div className="container">
      {error ? <><p role="alert">{error}</p><button onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button><button onClick={logout}>Sair</button></> : <p>Verificando sessão...</p>}
    </div>;
  }
  return <>{children}</>;
}
