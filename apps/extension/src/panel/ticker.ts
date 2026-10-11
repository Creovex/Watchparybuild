// Runs the room's 20 second touch and 60 second clock timers from a Web Worker, as the room page
// does. The panel is usually visible, but the member may switch tabs while the film plays or sits
// paused; a worker keeps the touch timer on time either way. Falls back to a page timer when a
// worker cannot start.

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const callbacks = new Map<number, () => void>();

function getWorker(): Worker | null {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<number>) => callbacks.get(event.data)?.();
  } catch {
    failed = true;
    worker = null;
  }
  return worker;
}

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
