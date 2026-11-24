import React, { useEffect, useState } from 'react';
import {
  createMarketplaceCategory, deleteMarketplaceCategory, getMarketplaceCategories, renameMarketplaceCategory,
} from '../services/api';
import type { MarketplaceCategory } from '../services/api';

export function AdminCategories() {
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [kind, setKind] = useState<MarketplaceCategory['kind']>('product');
  const [editing, setEditing] = useState<MarketplaceCategory | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirmAction, showToast } = useFeedback();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getMarketplaceCategories().then((list) => {
      if (active) setCategories(list);
    }).catch(() => {
      if (active) setError('Não foi possível carregar as categorias.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function resetForm() {
    setEditing(null);
    setLabel('');
    setError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !label.trim()) return;
    setSaving(true);
    setError('');
    try {
      const category = editing
        ? await renameMarketplaceCategory(editing, label.trim())
        : await createMarketplaceCategory(kind, label.trim());
      setCategories((list) => [...list.filter((item) => item.kind !== category.kind || item.value !== category.value), category]);
      resetForm();
      showToast(editing ? 'Categoria atualizada.' : 'Categoria cadastrada.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível salvar a categoria.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(category: MarketplaceCategory) {
    if (saving || !(await confirmAction({ title: 'Excluir categoria?', message: category.label, confirmLabel: 'Excluir categoria' }))) return;
    setSaving(true);
    setError('');
    try {
      await deleteMarketplaceCategory(category);
      setCategories((list) => list.filter((item) => item.kind !== category.kind || item.value !== category.value));
      if (editing?.value === category.value) resetForm();
      showToast('Categoria excluída.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível excluir a categoria.');
    } finally {
      setSaving(false);
    }
  }

  const visible = categories.filter((category) => category.kind === kind)
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  return (
    <section className="form-box" aria-labelledby="admin-categories-heading">
      <h2 id="admin-categories-heading">Categorias</h2>
      <form onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="category-kind">Tipo de categoria</label>
          <select id="category-kind" value={kind} disabled={saving} onChange={(event) => {
            setKind(event.target.value === 'business' ? 'business' : 'product');
            resetForm();
          }}>
            <option value="product">Produtos</option>
            <option value="business">Lojas</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="category-label">{editing ? 'Editar nome da categoria' : 'Nome da categoria'}</label>
          <input id="category-label" value={label} maxLength={100} required disabled={saving}
            onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div className="admin-category-actions">
          <button className="btn-primary" disabled={saving || loading} type="submit">
            {editing ? 'Salvar categoria' : 'Adicionar categoria'}
          </button>
          {editing && <button type="button" className="btn-secondary" disabled={saving} onClick={resetForm}>Cancelar</button>}
        </div>
      </form>
      {error && <p role="alert" className="error-message">{error}</p>}
      {loading && <p role="status">Carregando categorias…</p>}
      {!loading && !visible.length && !error && <p>Nenhuma categoria cadastrada.</p>}
      {!!visible.length && (
        <ul className="admin-category-list" aria-label="Categorias cadastradas" tabIndex={0}>
          {visible.map((category) => (
            <li key={category.value}>
              <span>{category.label}</span>
              <div className="admin-category-actions">
                <button type="button" className="btn-secondary" disabled={saving} aria-label={'Editar ' + category.label}
                  onClick={() => {
                    resetForm();
                    setEditing(category);
                    setLabel(category.label);
                    document.getElementById('category-label')?.focus();
                  }}>Editar</button>
                <button type="button" className="btn-secondary" disabled={saving} aria-label={'Excluir ' + category.label}
                  onClick={() => void remove(category)}>Excluir</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
import { useFeedback } from './Feedback';
