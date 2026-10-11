// Interval timers in a dedicated worker. Browsers slow page timers in hidden tabs to about once a
// minute after a few minutes, which would make the member flap absent; worker timers are not slowed
// that way. Messages: { id, ms } starts a timer, { id, stop: true } stops it.

const timers = new Map<number, ReturnType<typeof setInterval>>();

self.onmessage = (event: MessageEvent<{ id: number; ms?: number; stop?: boolean }>) => {
  const { id, ms, stop } = event.data;
  const existing = timers.get(id);
  if (existing !== undefined) clearInterval(existing);
  timers.delete(id);
  if (stop || !ms) return;
  timers.set(
    id,
    setInterval(() => self.postMessage(id), ms),
  );
};
