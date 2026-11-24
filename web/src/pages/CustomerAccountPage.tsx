import React, { useEffect, useRef, useState } from 'react';
import { useFeedback } from '../components/Feedback';
import axios from 'axios';
import { useAuthStore } from '../context/store';
import { CheckoutAddress, emptyDeliveryAddress, isDeliveryAddressComplete } from '../components/CheckoutAddress';
import {
  getCustomerProfile, getSavedDeliveryAddresses, resolveAssetUrl, saveCustomerAddress, saveCustomerAvatar, saveCustomerProfile,
} from '../services/api';
import type { CustomerProfile, SavedDeliveryAddress } from '../services/api';
import '../styles/product-form.css';
import '../styles/customer-account.css';

function profileForm(profile: CustomerProfile) {
  return { fullName: profile.full_name, email: profile.email, phone: profile.phone || '', currentPassword: '' };
}

export function CustomerAccountPage() {
  const userId = useAuthStore((state) => state.userId);
  return <CustomerAccount key={userId} />;
}

function CustomerAccount() {
  const [profile, setProfile] = useState<CustomerProfile>();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', currentPassword: '' });
  const [addresses, setAddresses] = useState<SavedDeliveryAddress[]>([]);
  const [editor, setEditor] = useState<string | null>(null);
  const [address, setAddress] = useState(emptyDeliveryAddress);
  const [photo, setPhoto] = useState<File>();
  const imageInput = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useFeedback();
  const changingEmail = profile && form.email.trim().toLowerCase() !== profile.email.toLowerCase();

  useEffect(() => {
    const request = new AbortController();
    Promise.all([getCustomerProfile(request.signal), getSavedDeliveryAddresses(request.signal)])
      .then(([customer, entries]) => {
        if (request.signal.aborted) return;
        setProfile(customer);
        setForm(profileForm(customer));
        setAddresses(entries);
      })
      .catch(() => {
        if (!request.signal.aborted) setError('Não foi possível carregar sua conta. Atualize a página para tentar novamente.');
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, []);

  async function action(run: () => Promise<void>, success: string) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await run();
      showToast(success);
    } catch (err) {
      setError(axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
        ? err.response.data.error : 'Não foi possível salvar a alteração.');
    } finally {
      setSaving(false);
    }
  }

  function uploadPhoto(event: React.FormEvent) {
    event.preventDefault();
    if (!photo) return;
    if (photo.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(photo.type)) {
      setError('Escolha uma imagem JPEG, PNG, WebP ou GIF de até 5 MB.');
      return;
    }
    void action(async () => {
      const result = await saveCustomerAvatar(photo);
      setProfile((current) => current && { ...current, avatar_url: result.avatar_url });
      setPhoto(undefined);
      if (imageInput.current) imageInput.current.value = '';
    }, 'Foto de perfil atualizada.');
  }

  function updateProfile(event: React.FormEvent) {
    event.preventDefault();
    void action(async () => {
      const updated = await saveCustomerProfile({ ...form, currentPassword: changingEmail ? form.currentPassword : '' });
      setProfile(updated);
      setForm(profileForm(updated));
    }, 'Dados pessoais atualizados.');
  }

  function openAddress(entry?: SavedDeliveryAddress) {
    setAddress(entry?.address ?? emptyDeliveryAddress);
    setEditor(entry?.id ?? 'new');
    setError('');
  }

  function updateAddress(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || saving) return;
    if (!isDeliveryAddressComplete(address)) {
      setError('Informe CEP, logradouro, número, cidade e UF.');
      return;
    }
    const editingId = editor === 'new' ? undefined : editor;
    void action(async () => {
      const saved = await saveCustomerAddress(address, editingId);
      setAddresses((items) => editingId ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved]);
      setEditor(null);
    }, editingId ? 'Endereço atualizado.' : 'Endereço adicionado.');
  }

  return (
    <main className="customer-account">
      <div className="container">
        <h1>Minha conta</h1>
        {loading && <p role="status">Carregando sua conta…</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {profile && (
          <div className="account-grid">
            <section className="form-box" aria-labelledby="profile-heading">
              <h2 id="profile-heading">Dados pessoais</h2>
              <form onSubmit={uploadPhoto} className="account-photo">
                {profile.avatar_url
                  ? <img src={resolveAssetUrl(profile.avatar_url)} alt="Sua foto de perfil" />
                  : <span className="account-initial" aria-hidden="true">{profile.full_name.trim().charAt(0).toUpperCase()}</span>}
                <div className="form-group">
                  <label htmlFor="profile-photo">Foto de perfil</label>
                  <input id="profile-photo" ref={imageInput} type="file" disabled={saving}
                    accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setPhoto(event.target.files?.[0])} />
                  <button type="submit" className="btn-secondary" disabled={saving || !photo}>Salvar foto</button>
                </div>
              </form>
              <form onSubmit={updateProfile}>
                <fieldset disabled={saving}>
                  <div className="form-group">
                    <label htmlFor="profile-name">Nome completo</label>
                    <input id="profile-name" autoComplete="name" required maxLength={255} value={form.fullName}
                      onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="profile-email">E-mail</label>
                    <input id="profile-email" type="email" autoComplete="email" required maxLength={255} value={form.email}
                      onChange={(event) => setForm({ ...form, email: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="profile-phone">Telefone (opcional)</label>
                    <input id="profile-phone" type="tel" autoComplete="tel" maxLength={20} value={form.phone}
                      onChange={(event) => setForm({ ...form, phone: event.target.value })} />
                  </div>
                  {changingEmail && (
                    <div className="form-group">
                      <label htmlFor="profile-password">Senha atual para alterar o e-mail</label>
                      <input id="profile-password" type="password" autoComplete="current-password" required value={form.currentPassword}
                        onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} />
                    </div>
                  )}
                  <button type="submit" className="btn-primary">Salvar dados</button>
                </fieldset>
              </form>
            </section>
            <section className="form-box" aria-labelledby="addresses-heading">
              <div className="account-section-heading">
                <h2 id="addresses-heading">Endereços de entrega</h2>
                {!editor && <button type="button" className="btn-secondary" disabled={saving} onClick={() => openAddress()}>Adicionar endereço</button>}
              </div>
              {!!addresses.length && (
                <ul className="account-address-list">
                  {addresses.map((entry, index) => {
                    const item = entry.address;
                    return (
                      <li key={entry.id}>
                        <div>
                          <strong>{item.street}, {item.number}{item.complement && ' · ' + item.complement}</strong>
                          {index === 0 && <p className="account-default">Endereço padrão</p>}
                          <p>{[item.neighborhood, item.city + '/' + item.state, 'CEP ' + item.cep].filter(Boolean).join(' · ')}</p>
                        </div>
                        <button type="button" className="btn-secondary" disabled={saving || editor === entry.id}
                          aria-label={'Editar endereço ' + item.street + ', ' + item.number} onClick={() => openAddress(entry)}>Editar</button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!addresses.length && !editor && <p>Você ainda não tem endereços salvos.</p>}
              {editor && (
                <form className="account-address-form" onSubmit={updateAddress}>
                  <h3>{editor === 'new' ? 'Novo endereço' : 'Editar endereço'}</h3>
                  <CheckoutAddress key={editor} address={address} onChange={setAddress} disabled={saving} />
                  <div className="account-actions">
                    <button type="submit" className="btn-primary" disabled={saving}>Salvar endereço</button>
                    <button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditor(null)}>Cancelar</button>
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
