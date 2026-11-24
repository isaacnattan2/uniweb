import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../context/store';
import { getMarketplaceComments, getMyMarketplaceReview, rateMarketplaceItem } from '../services/api';
import type { MarketplaceComment, RatingSummary } from '../services/api';

export function RatingLabel({ rating, rating_count }: RatingSummary) {
  if (!rating_count) return <>Sem notas em estrelas</>;
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
  const [comment, setComment] = useState('');
  const [eligibility, setEligibility] = useState<'loading' | 'allowed' | 'denied' | 'unavailable' | 'moderated'>('loading');
  const [comments, setComments] = useState<MarketplaceComment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentsError, setCommentsError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const { showToast } = useFeedback();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || userType !== 'customer') return;
    let active = true;
    setEligibility('loading');
    getMyMarketplaceReview(kind, id).then(({ eligible, review }) => {
      if (!active) return;
      setEligibility(!eligible ? 'denied' : review && review.status !== 'approved' ? 'moderated' : 'allowed');
      setChoice(review?.rating ?? 0);
      setComment(review?.comment ?? '');
    }).catch(() => { if (active) setEligibility('unavailable'); });
    return () => { active = false; };
  }, [kind, id, token, userType]);

  useEffect(() => {
    let active = true;
    setLoadingComments(true);
    setCommentsError(false);
    getMarketplaceComments(kind, id, page).then((result) => {
      if (!active) return;
      setComments((previous) => page === 0 ? result.comments : [
        ...previous, ...result.comments.filter((item) => !previous.some((old) => old.id === item.id)),
      ]);
      setHasMore(result.hasMore);
    }).catch(() => { if (active) setCommentsError(true); })
      .finally(() => { if (active) setLoadingComments(false); });
    return () => { active = false; };
  }, [kind, id, page, refresh]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || eligibility !== 'allowed' || (!choice && !comment.trim())) return;
    setSaving(true);
    setError('');
    try {
      const summary = await rateMarketplaceItem(kind, id, { rating: choice || null, comment: comment.trim() || null });
      onRated(summary);
      setPage(0);
      setRefresh((value) => value + 1);
      showToast('Avaliação salva.');
    } catch (err: any) {
      if (err.response?.status === 403) setEligibility('denied');
      setError(err.response?.data?.error || 'Não foi possível registrar sua avaliação.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rating-control" aria-label={kind === 'business' ? 'Avaliações da loja' : 'Avaliações do produto'}>
      <h3>Comentários</h3>
      {!token && <Link to="/login" state={{ from: pathname + search }}>Entre para avaliar uma compra</Link>}
      {token && userType === 'customer' && (
        <>
          {eligibility === 'denied' && <p>{kind === 'business'
            ? 'Quem já tem uma compra paga nesta loja pode avaliá-la.'
            : 'Quem já comprou e pagou por este produto pode avaliá-lo.'}</p>}
          {eligibility === 'loading' && <p role="status">Verificando compras…</p>}
          {eligibility === 'unavailable' && <p role="alert">Não foi possível verificar suas compras.</p>}
          {eligibility === 'moderated' && <p>Sua avaliação está indisponível para edição.</p>}
          {eligibility === 'allowed' && (
            <form onSubmit={save}>
              <fieldset disabled={saving}>
                <legend>Estrelas (opcional)</legend>
                <div role="group" aria-label="Nota de uma a cinco estrelas">
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button key={rating} type="button" aria-pressed={rating === choice}
                      aria-label={rating + (rating === 1 ? ' estrela' : ' estrelas')}
                      onClick={() => setChoice(rating === choice ? 0 : rating)}>
                      {rating <= choice ? '★' : '☆'}
                    </button>
                  ))}
                </div>
                <label className="rating-comment-field">
                  Seu comentário
                  <textarea rows={3} maxLength={1500} value={comment} onChange={(event) => setComment(event.target.value)} />
                </label>
                <button className="btn-primary" type="submit" disabled={!choice && !comment.trim()}>
                  {saving ? 'Salvando…' : 'Salvar avaliação'}
                </button>
              </fieldset>
            </form>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!!comments.length && (
        <ul className="marketplace-comments">
          {comments.map((item) => (
            <li key={item.id}>
              <strong>{item.author || 'Cliente'}</strong>
              {item.rating !== null && <span aria-label={item.rating + ' de 5 estrelas'}> · {'★'.repeat(item.rating)}</span>}
              <p>{item.comment}</p>
            </li>
          ))}
        </ul>
      )}
      {loadingComments && <p role="status">Carregando comentários…</p>}
      {!loadingComments && !commentsError && !comments.length && <p>Nenhum comentário ainda.</p>}
      {commentsError && <p role="alert">Não foi possível carregar os comentários. <button type="button" className="btn-secondary" onClick={() => setRefresh((value) => value + 1)}>Tentar novamente</button></p>}
      {hasMore && !commentsError && <button type="button" className="btn-secondary" disabled={loadingComments || saving}
        onClick={() => setPage((value) => value + 1)}>Ver mais comentários</button>}
    </section>
  );
}
import { useFeedback } from './Feedback';
