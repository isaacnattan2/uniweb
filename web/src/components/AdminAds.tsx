import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { deleteAdminAd, getAdminAds, saveAdminAd, uploadImages } from '../services/api';
import type { AdminAd, AdminBusiness } from '../services/api';
import { ShopCarousel } from './ShopCarousel';

const empty = { businessId: '', title: '', position: 0, published: false, imageUrl: '' };

export function AdminAds({ businesses }: { businesses: AdminBusiness[] }) {
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string>();
  const [file, setFile] = useState<File>();
  const [filePreview, setFilePreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    getAdminAds().then((rows) => { if (active) setAds(rows); })
      .catch(() => { if (active) setError('Não foi possível carregar as publicidades.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!file) {
      setFilePreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => { URL.revokeObjectURL(url); };
  }, [file]);

  function clearForm() {
    setForm(empty);
    setEditing(undefined);
    setFile(undefined);
  }

  async function act(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await action();
      setNotice(success);
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error || 'Não foi possível salvar a alteração.' : 'Não foi possível salvar a alteração.');
    } finally {
      setBusy(false);
    }
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!file && !form.imageUrl) {
      setError('Escolha uma imagem para a publicidade.');
      return;
    }
    if (file && (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setError('Use uma imagem JPEG, PNG, WebP ou GIF de até 5 MB.');
      return;
    }
    void act(async () => {
      let imageUrl = form.imageUrl;
      if (file) {
        const { urls } = await uploadImages([file]);
        const uploaded = urls?.[0];
        if (!uploaded) throw new Error('Imagem indisponível');
        imageUrl = uploaded;
        setForm((current) => ({ ...current, imageUrl }));
        setFile(undefined);
        const input = document.getElementById('ad-image') as HTMLInputElement | null;
        if (input) input.value = '';
      }
      const saved = await saveAdminAd({ ...form, imageUrl }, editing);
      setAds((rows) => editing ? rows.map((ad) => ad.id === saved.id ? saved : ad) : [...rows, saved]);
      clearForm();
    }, form.published ? 'Publicidade salva como publicada.' : 'Rascunho salvo.');
  }

  function edit(ad: AdminAd) {
    setEditing(ad.id);
    setForm({ businessId: ad.business_id, title: ad.title, position: ad.position, published: ad.published, imageUrl: ad.image_url });
    setFile(undefined);
    setNotice('');
    setError('');
    document.getElementById('ad-title')?.focus();
  }

  const sorted = [...ads].sort((a, b) => a.position - b.position);
  const draftImage = filePreview || form.imageUrl;
  const previewAds = draftImage ? [
    ...sorted.filter((ad) => ad.id !== editing),
    { id: editing || 'draft', business_id: form.businessId, title: form.title || 'Prévia da imagem', image_url: draftImage, position: form.position },
  ].sort((a, b) => a.position - b.position) : sorted;

  return (
    <section className="form-box admin-ads" aria-labelledby="ads-title">
      <h2 id="ads-title">Publicidades da vitrine</h2>
      <form onSubmit={save}>
        <fieldset disabled={busy || loading}>
          <legend>{editing ? 'Editar publicidade' : 'Nova publicidade'}</legend>
          <div className="admin-ads-fields">
            <div className="form-group">
              <label htmlFor="ad-title">Título da imagem</label>
              <input id="ad-title" value={form.title} maxLength={150} required
                onChange={(event) => setForm({ ...form, title: event.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="ad-business">Loja anunciada</label>
              <select id="ad-business" value={form.businessId} required onChange={(event) => setForm({ ...form, businessId: event.target.value })}>
                <option value="">Selecione uma loja</option>
                {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="ad-image">Imagem da publicidade</label>
              <input key={editing || 'new'} id="ad-image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                required={!form.imageUrl} onChange={(event) => setFile(event.target.files?.[0])} aria-describedby="ad-image-hint" />
              <small id="ad-image-hint">Use uma imagem horizontal. Recomendado 1600 × 450 px, até 5 MB.</small>
            </div>
            <div className="form-group">
              <label htmlFor="ad-position">Ordem de exibição</label>
              <input id="ad-position" type="number" min={0} max={2147483647} step={1} required value={form.position}
                onChange={(event) => setForm({ ...form, position: event.target.valueAsNumber })} />
              <small>Os menores números aparecem primeiro.</small>
            </div>
          </div>
          <label className="admin-ad-publish"><input type="checkbox" checked={form.published}
            onChange={(event) => setForm({ ...form, published: event.target.checked })} /> Publicar na vitrine</label>
          <div className="admin-category-actions">
            <button className="btn-primary" type="submit">{busy ? 'Salvando…' : 'Salvar publicidade'}</button>
            {editing && <button className="btn-secondary" type="button" onClick={clearForm}>Cancelar</button>}
          </div>
        </fieldset>
      </form>
      {error && <p role="alert" className="error-message">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h3>Prévia do carrossel</h3>
      <p>A prévia inclui rascunhos. A vitrine exibe as publicidades publicadas de lojas ativas.</p>
      {previewAds.length ? <ShopCarousel key={draftImage ? draftImage : 'saved'} ads={previewAds} preview initialId={draftImage ? editing || 'draft' : undefined} />
        : <p>{loading ? 'Carregando publicidades…' : 'Adicione uma imagem para visualizar o carrossel.'}</p>}
      {!!sorted.length && <ul className="admin-category-list" aria-label="Publicidades cadastradas">
        {sorted.map((ad) => (
          <li key={ad.id}>
            <span><strong>{ad.title}</strong> · {businesses.find((b) => b.id === ad.business_id)?.name || 'Loja'} · {ad.published ? 'Publicada' : 'Rascunho'} · Ordem {ad.position}</span>
            <div className="admin-category-actions">
              <button className="btn-secondary" type="button" disabled={busy} onClick={() => edit(ad)}>Editar</button>
              <button className="btn-secondary" type="button" disabled={busy} onClick={() => {
                if (!window.confirm('Excluir a publicidade “' + ad.title + '”?')) return;
                void act(async () => {
                  await deleteAdminAd(ad.id);
                  setAds((rows) => rows.filter((row) => row.id !== ad.id));
                  if (editing === ad.id) clearForm();
                }, 'Publicidade excluída.');
              }}>Excluir</button>
            </div>
          </li>
        ))}
      </ul>}
    </section>
  );
}
