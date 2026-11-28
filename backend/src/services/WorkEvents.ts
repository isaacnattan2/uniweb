type Work = 'dispatch' | 'refunds' | 'cards';
const listeners = new Map<Work, () => void>();

export function onWork(work: Work, listener: () => void) {
  listeners.set(work, listener);
}

export function wakeWork(work: Work) {
  listeners.get(work)?.();
}
