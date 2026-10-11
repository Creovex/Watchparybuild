// A minimal external store for React's useSyncExternalStore: one immutable snapshot, replaced on
// every change, so components re-render only when the part they read changes.

export class Store<T> {
  private snapshot: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.snapshot = initial;
  }

  get = (): T => this.snapshot;

  set(next: Partial<T> | ((current: T) => Partial<T>)): void {
    const patch = typeof next === 'function' ? next(this.snapshot) : next;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
