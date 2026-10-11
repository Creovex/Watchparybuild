// Pairs each streaming tab's content script with the panel inside the same tab, so the worker can
// relay between them. One pair per tab: a second connection of the same kind for a tab replaces the
// first, and the replaced port is disconnected. Pure logic with no chrome APIs, so it is unit tested.

export type PortKind = 'content' | 'panel';

export interface PairPort {
  postMessage(message: unknown): void;
  disconnect(): void;
}

interface Pair<P> {
  content?: P;
  panel?: P;
}

function otherKind(kind: PortKind): PortKind {
  return kind === 'content' ? 'panel' : 'content';
}

function safePost(port: PairPort, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    // The other end went away between the check and the send.
    return false;
  }
}

export class PortPairing<P extends PairPort> {
  private readonly tabs = new Map<number, Pair<P>>();

  /** Registers a port for a tab, replacing any earlier port of the same kind, and tells both sides. */
  connect(tabId: number, kind: PortKind, port: P): void {
    const pair = this.tabs.get(tabId) ?? {};
    const previous = pair[kind];
    pair[kind] = port;
    this.tabs.set(tabId, pair);
    if (previous && previous !== port) {
      try {
        previous.disconnect();
      } catch {
        // Already gone.
      }
    }
    const other = pair[otherKind(kind)];
    safePost(port, { type: 'peer', connected: Boolean(other) });
    if (other) safePost(other, { type: 'peer', connected: true });
  }

  /** Forgets a port that disconnected. Ports already replaced are ignored. */
  disconnect(tabId: number, kind: PortKind, port: P): void {
    const pair = this.tabs.get(tabId);
    if (!pair || pair[kind] !== port) return;
    delete pair[kind];
    const other = pair[otherKind(kind)];
    if (other) safePost(other, { type: 'peer', connected: false });
    if (!pair.content && !pair.panel) this.tabs.delete(tabId);
  }

  /**
   * Sends a message from one side to the other side of the same tab. Messages from a port that is
   * no longer the registered one for its tab are dropped. Returns true when delivered.
   */
  relay(tabId: number, from: PortKind, port: P, message: unknown): boolean {
    const pair = this.tabs.get(tabId);
    if (!pair || pair[from] !== port) return false;
    const other = pair[otherKind(from)];
    if (!other) return false;
    return safePost(other, message);
  }

  /** Sends a message from the worker to one side of a tab. */
  send(tabId: number, kind: PortKind, message: unknown): boolean {
    const port = this.tabs.get(tabId)?.[kind];
    return port ? safePost(port, message) : false;
  }

  get(tabId: number, kind: PortKind): P | undefined {
    return this.tabs.get(tabId)?.[kind];
  }

  /** Drops both sides of a tab, for example when the tab closes. */
  removeTab(tabId: number): void {
    this.tabs.delete(tabId);
  }

  get size(): number {
    return this.tabs.size;
  }
}
