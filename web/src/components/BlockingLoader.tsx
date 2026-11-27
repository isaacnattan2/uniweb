import { useLayoutEffect, useRef } from 'react';
import './blocking-loader.css';

export function BlockingLoader({ message }: { message: string }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="blocking-loader" aria-label={message} onCancel={(event) => event.preventDefault()}>
      <span className="blocking-loader-spinner" aria-hidden="true" />
      <p role="status">{message}</p>
    </dialog>
  );
}
