import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../context/store';
import { rateMarketplaceItem } from '../services/api';
import type { RatingSummary } from '../services/api';

export function RatingLabel({ rating, rating_count }: RatingSummary) {
  if (!rating_count) return <>Sem avaliações</>;
  return <>★ {Number(rating).toLocaleString('pt-BR')} ({rating_count} {rating_count === 1 ? 'avaliação' : 'avaliações'})</>;
}

export function RatingControl({ kind, id, onRated }: {
  kind: 'business' | 'product';
  id: string;
  onRated: (summary: RatingSummary) => void;
}) {
  const userType = useAuthStore((state) => state.userType);
  const token = useAuthStore((state) => state.token);
  const { pathname, search } = useLocation();
  const [choice, setChoice] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(rating: number) {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      onRated(await rateMarketplaceItem(kind, id, rating));
      setChoice(rating);
      setMessage('Avaliação salva.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível registrar sua avaliação.');
    } finally {
      setSaving(false);
    }
  }

  if (!token) return <Link to="/login" state={{ from: pathname + search }}>Entre para avaliar</Link>;
  if (userType !== 'customer') return null;

  return (
    <div className="rating-control">
      <div role="group" aria-label={kind === 'business' ? 'Avaliar loja' : 'Avaliar produto'}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <button key={rating} type="button" disabled={saving} aria-pressed={rating === choice}
            aria-label={rating + (rating === 1 ? ' estrela' : ' estrelas')} onClick={() => void save(rating)}>
            {rating <= choice ? '★' : '☆'}
          </button>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
