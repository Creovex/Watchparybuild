import type { PlaybackStatus } from './schemas';

export interface TimedState {
  status: PlaybackStatus;
  position_sec: number;
  rate: number;
  /** The moment `position_sec` applies, as epoch milliseconds or an ISO timestamp. */
  server_ts: number | string;
}

export function serverTsMs(state: Pick<TimedState, 'server_ts'>): number {
  return typeof state.server_ts === 'number' ? state.server_ts : Date.parse(state.server_ts);
}

/** True while a play is scheduled for a moment that has not arrived yet (the countdown). */
export function isCountdown(state: TimedState, serverNowMs: number): boolean {
  return state.status === 'playing' && serverNowMs < serverTsMs(state);
}

/** Where every member should be right now, in seconds. */
export function expectedPosition(state: TimedState, serverNowMs: number): number {
  const ts = serverTsMs(state);
  if (state.status === 'playing' && serverNowMs >= ts) {
    return state.position_sec + ((serverNowMs - ts) / 1000) * state.rate;
  }
  return state.position_sec;
}
