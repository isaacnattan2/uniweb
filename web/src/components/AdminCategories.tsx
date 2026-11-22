import React, { useEffect, useState } from 'react';
import { createMarketplaceCategory, getMarketplaceCategories } from '../services/api';
import type { MarketplaceCategory } from '../services/api';

export function AdminCategories() {
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [kind, setKind] = useState<MarketplaceCategory['kind']>('product');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getMarketplaceCategories().then((list) => {
      if (active) setCategories(list);
    }).catch(() => {
      if (active) setError('Não foi possível carregar as categorias.');
    });
    return () => { active = false; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !label.trim()) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const category = await createMarketplaceCategory(kind, label.trim());
      setCategories((list) => [...list.filter((item) => item.kind !== category.kind || item.value !== category.value), category]);
      setLabel('');
      setMessage('Categoria cadastrada.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível cadastrar a categoria.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="form-box" aria-labelledby="admin-categories-heading">
      <h2 id="admin-categories-heading">Categorias</h2>
      <form onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="category-kind">Tipo de categoria</label>
          <select id="category-kind" value={kind} disabled={saving}
            onChange={(event) => setKind(event.target.value === 'business' ? 'business' : 'product')}>
            <option value="product">Produtos</option>
            <option value="business">Lojas</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="category-label">Nome da categoria</label>
          <input id="category-label" value={label} maxLength={100} required disabled={saving}
            onChange={(event) => setLabel(event.target.value)} />
        </div>
        <button className="btn-primary" disabled={saving} type="submit">Adicionar categoria</button>
      </form>
      {error && <p role="alert" className="error-message">{error}</p>}
      {message && <p role="status">{message}</p>}
      <ul aria-label="Categorias cadastradas">
        {categories.filter((category) => category.kind === kind).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
          .map((category) => <li key={category.value}>{category.label}</li>)}
      </ul>
    </section>
  );
}
