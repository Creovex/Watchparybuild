'use client';

let worker: Worker | null = null;
let nextId = 1;
const callbacks = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker('/workers/ticker.js');
    worker.onmessage = (event: MessageEvent<number>) => callbacks.get(event.data)?.();
  } catch {
    worker = null;
  }
  return worker;
}

/** Runs `cb` every `ms` from a Web Worker, falling back to a page timer when workers are unavailable. */
export function workerTicker(ms: number, cb: () => void): () => void {
  const w = getWorker();
  if (!w) {
    const id = setInterval(cb, ms);
    return () => clearInterval(id);
  }
  const id = nextId++;
  callbacks.set(id, cb);
  w.postMessage({ id, ms });
  return () => {
    callbacks.delete(id);
    w.postMessage({ id, stop: true });
  };
}
