// Timers for the room page. Browsers throttle timers in hidden tabs to about once a minute, which
// would make members drop out of the room; timers in a dedicated worker keep their schedule.
const timers = new Map();
self.onmessage = (event) => {
  const { id, ms, stop } = event.data || {};
  if (typeof id !== 'number') return;
  clearInterval(timers.get(id));
  timers.delete(id);
  if (stop) return;
  timers.set(id, setInterval(() => self.postMessage(id), ms));
};
