type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifySyncComplete(): void {
  listeners.forEach((fn) => fn());
}
