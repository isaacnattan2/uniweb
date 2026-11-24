import React, { useEffect, useState } from 'react';
import { useFeedback } from './Feedback';
import { getDriverAppTheme, updateDriverAppTheme } from '../services/api';
import type { DriverAppTheme } from '../services/api';

const defaultTheme: DriverAppTheme = { primary: '#1762d1', secondary: '#152844' };

export function AdminAppTheme() {
  const [theme, setTheme] = useState<DriverAppTheme>();
  const [pending, setPending] = useState<'save' | 'reset'>();
  const [error, setError] = useState('');
  const { showToast } = useFeedback();

  useEffect(() => {
    const controller = new AbortController();
    void getDriverAppTheme(controller.signal).then(setTheme).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível carregar as cores do app.');
    });
    return () => controller.abort();
  }, []);

  async function applyTheme(action: 'save' | 'reset') {
    if (!theme || pending) return;
    const resetting = action === 'reset';
    setPending(action);
    setError('');
    try {
      setTheme(await updateDriverAppTheme(resetting ? defaultTheme : theme));
      showToast(resetting ? 'Cores padrão do UniEntregador restauradas.' : 'Cores do UniEntregador atualizadas.');
    } catch {
      setError(resetting ? 'Não foi possível restaurar as cores padrão do app.' : 'Não foi possível salvar as cores do app.');
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section className="form-box admin-app-theme" aria-labelledby="driver-app-theme-title">
      <h2 id="driver-app-theme-title">Cores do UniEntregador</h2>
      {error && <p role="alert">{error}</p>}
      {!theme && !error && <p role="status">Carregando cores…</p>}
      {theme && <form onSubmit={(event) => {
        event.preventDefault();
        void applyTheme('save');
      }}>
        <div className="form-row">
          {(['primary', 'secondary'] as const).map((key) => (
            <div className="form-group" key={key}>
              <label htmlFor={`driver-app-${key}`}>{key === 'primary' ? 'Cor primária' : 'Cor secundária'}</label>
              <div className="app-theme-swatch">
                <input id={`driver-app-${key}`} type="color" value={theme[key]} disabled={!!pending}
                  onChange={(event) => {
                    setTheme({ ...theme, [key]: event.target.value });
                  }} />
                <output htmlFor={`driver-app-${key}`}>{theme[key].toUpperCase()}</output>
              </div>
            </div>
          ))}
        </div>
        <div className="app-theme-actions">
          <button type="submit" className="btn-primary" disabled={!!pending}>
            {pending === 'save' ? 'Salvando…' : 'Salvar cores'}
          </button>
          <button type="button" className="btn-secondary" disabled={!!pending} onClick={() => void applyTheme('reset')}>
            {pending === 'reset' ? 'Restaurando…' : 'Restaurar cores padrão'}
          </button>
        </div>
      </form>}
    </section>
  );
}
