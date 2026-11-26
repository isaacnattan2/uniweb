import { useId, useState } from 'react';
import { getUnmetPasswordRequirements } from '../utils/passwordPolicy';

export function PasswordFields({ password, confirmation, onPassword, onConfirmation, label = 'Senha', disabled = false }: {
  password: string;
  confirmation: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const unmet = getUnmetPasswordRequirements(password);
  const matches = password !== '' && confirmation === password;
  const complete = matches && unmet.length === 0;
  return (
    <>
      <div className="form-group">
        <label htmlFor={id + '-password'}>{label}</label>
        <div className="password-input">
          <input id={id + '-password'} type={visible ? 'text' : 'password'} autoComplete="new-password"
            autoCapitalize="none" spellCheck={false} required disabled={disabled}
            aria-describedby={id + '-policy'} value={password} onChange={(event) => onPassword(event.target.value)} />
          <button type="button" className="password-visibility" aria-controls={id + '-password'}
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} disabled={disabled}
            onClick={() => setVisible((current) => !current)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
              <circle cx="12" cy="12" r="2.5" />
              {visible && <path d="m3 3 18 18" />}
            </svg>
          </button>
        </div>
        <div id={id + '-policy'} className="password-feedback" aria-live="polite">
          {unmet.length > 0 ? (
            <>
              <span>Requisitos pendentes</span>
              <ul>{unmet.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
            </>
          ) : <span className="password-feedback-success">Senha atende aos requisitos.</span>}
        </div>
      </div>
      <div className="form-group">
        <label htmlFor={id + '-confirmation'}>Confirmar senha</label>
        <input id={id + '-confirmation'} type="password" autoComplete="new-password" required disabled={disabled}
          aria-describedby={id + '-match'} aria-invalid={confirmation !== '' && !matches}
          value={confirmation} onChange={(event) => onConfirmation(event.target.value)} />
        <div id={id + '-match'} className="password-feedback" aria-live="polite">
          {complete ? <span className="password-feedback-success">Senha válida e confirmada.</span>
            : matches ? <span className="password-feedback-success">As senhas coincidem.</span>
              : confirmation ? <span className="password-feedback-error">As senhas estão diferentes.</span>
                : <span>Repita a senha para confirmar.</span>}
        </div>
      </div>
    </>
  );
}
