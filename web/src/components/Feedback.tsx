import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import '../styles/feedback.css';

type Confirmation = { title: string; message?: string; confirmLabel: string; dismissLabel?: string };
type ToastNotice = { id: number; message: string };
type Feedback = {
  confirmAction: (confirmation: Confirmation) => Promise<boolean>;
  showToast: (message: string) => void;
};

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('FeedbackProvider is required');
  return feedback;
}

function Toast({ notice, dismiss }: { notice: ToastNotice; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice.id), 6000);
    return () => window.clearTimeout(timer);
  }, [dismiss, notice.id]);

  return <div className="feedback-toast">
    <span>{notice.message}</span>
    <button type="button" className="feedback-toast-close" aria-label="Fechar aviso" onClick={() => dismiss(notice.id)}>×</button>
  </div>;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { key: locationKey } = useLocation();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [notices, setNotices] = useState<ToastNotice[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const nextId = useRef(0);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);

  const confirmAction = useCallback((request: Confirmation) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setConfirmation(request);
    });
  }, []);

  const finishConfirmation = useCallback((confirmed: boolean) => {
    const resolve = pending.current;
    if (!resolve) return;
    pending.current = null;
    dialog.current?.close();
    setConfirmation(null);
    resolve(confirmed);
  }, []);

  useEffect(() => {
    if (confirmation && !dialog.current?.open) dialog.current?.showModal();
  }, [confirmation]);

  useEffect(() => () => finishConfirmation(false), [finishConfirmation, locationKey]);

  const showToast = useCallback((message: string) => {
    const notice = { id: ++nextId.current, message };
    setNotices((current) => [...current.slice(-2), notice]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const feedback = useMemo(() => ({ confirmAction, showToast }), [confirmAction, showToast]);

  return <FeedbackContext.Provider value={feedback}>
    {children}
    <div className="feedback-toasts" aria-live="polite" aria-relevant="additions">
      {notices.map((notice) => <Toast key={notice.id} notice={notice} dismiss={dismissToast} />)}
    </div>
    <dialog ref={dialog} className="feedback-dialog" role="alertdialog" aria-labelledby="feedback-title"
      aria-describedby={confirmation?.message ? 'feedback-message' : undefined}
      onCancel={(event) => {
        event.preventDefault();
        finishConfirmation(false);
      }}>
      <h2 id="feedback-title">{confirmation?.title}</h2>
      {confirmation?.message && <p id="feedback-message">{confirmation.message}</p>}
      <div className="feedback-actions">
        <button type="button" className="btn-secondary" autoFocus onClick={() => finishConfirmation(false)}>
          {confirmation?.dismissLabel || 'Voltar'}
        </button>
        <button type="button" className="btn-primary feedback-danger" onClick={() => finishConfirmation(true)}>
          {confirmation?.confirmLabel}
        </button>
      </div>
    </dialog>
  </FeedbackContext.Provider>;
}
