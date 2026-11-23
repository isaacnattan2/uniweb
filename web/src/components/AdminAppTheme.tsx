import React, { useEffect, useState } from 'react';
import { getDriverAppTheme, updateDriverAppTheme } from '../services/api';
import type { DriverAppTheme } from '../services/api';

export function AdminAppTheme() {
  const [theme, setTheme] = useState<DriverAppTheme>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void getDriverAppTheme(controller.signal).then(setTheme).catch(() => {
      if (!controller.signal.aborted) setError('Não foi possível carregar as cores do app.');
    });
    return () => controller.abort();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!theme || saving) return;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      setTheme(await updateDriverAppTheme(theme));
      setNotice('Cores do UniEntregador atualizadas.');
    } catch {
      setError('Não foi possível salvar as cores do app.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="form-box admin-app-theme" aria-labelledby="driver-app-theme-title">
      <h2 id="driver-app-theme-title">Cores do UniEntregador</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!theme && !error && <p role="status">Carregando cores…</p>}
      {theme && <form onSubmit={(event) => void save(event)}>
        <div className="form-row">
          {(['primary', 'secondary'] as const).map((key) => (
            <div className="form-group" key={key}>
              <label htmlFor={`driver-app-${key}`}>{key === 'primary' ? 'Cor primária' : 'Cor secundária'}</label>
              <div className="app-theme-swatch">
                <input id={`driver-app-${key}`} type="color" value={theme[key]} disabled={saving}
                  onChange={(event) => {
                    setNotice('');
                    setTheme({ ...theme, [key]: event.target.value });
                  }} />
                <output htmlFor={`driver-app-${key}`}>{theme[key].toUpperCase()}</output>
              </div>
            </div>
          ))}
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar cores'}</button>
      </form>}
    </section>
  );
}
