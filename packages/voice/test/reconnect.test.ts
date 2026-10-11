import { describe, expect, it } from 'vitest';
import {
  FINAL_TOKEN_CODES,
  LIVEKIT_DISCONNECT,
  RECONNECT_WINDOW_MS,
  ReconnectWindow,
  meshVoiceState,
  retryDelayMs,
  serverDisconnectAction,
} from '../src/reconnect';
import { FakeClock } from './fakes';

describe('reconnect window', () => {
  it('gives up after 30 seconds', () => {
    expect(RECONNECT_WINDOW_MS).toBe(30_000);
    const clock = new FakeClock();
    let expired = 0;
    const w = new ReconnectWindow(clock, () => expired++);
    w.begin();
    clock.advance(29_999);
    expect(expired).toBe(0);
    expect(w.remainingMs()).toBe(1);
    clock.advance(1);
    expect(expired).toBe(1);
    expect(w.running).toBe(false);
  });

  it('recovering inside the window cancels it', () => {
    const clock = new FakeClock();
    let expired = 0;
    const w = new ReconnectWindow(clock, () => expired++);
    w.begin();
    clock.advance(20_000);
    w.end();
    clock.advance(60_000);
    expect(expired).toBe(0);
    expect(w.remainingMs()).toBeNull();
  });

  it('a second begin does not extend the window', () => {
    const clock = new FakeClock();
    let expired = 0;
    const w = new ReconnectWindow(clock, () => expired++);
    w.begin();
    clock.advance(20_000);
    w.begin();
    clock.advance(10_000);
    expect(expired).toBe(1);
  });

  it('a new outage after recovery gets a full window again', () => {
    const clock = new FakeClock();
    let expired = 0;
    const w = new ReconnectWindow(clock, () => expired++);
    w.begin();
    clock.advance(25_000);
    w.end();
    w.begin();
    clock.advance(25_000);
    expect(expired).toBe(0);
    clock.advance(5_000);
    expect(expired).toBe(1);
  });
});

describe('mesh voice state', () => {
  const base = { online: true, everConnected: false, connected: 0, dropped: 0, pending: 0 };

  it('alone in voice is connected', () => {
    expect(meshVoiceState(base)).toBe('connected');
  });

  it('a fresh join waiting for members already in voice is connecting', () => {
    expect(meshVoiceState({ ...base, pending: 1 })).toBe('connecting');
  });

  it('a new member arriving does not disturb a connected session', () => {
    expect(meshVoiceState({ ...base, everConnected: true, pending: 1 })).toBe('connected');
  });

  it('one live connection is enough to be connected', () => {
    expect(meshVoiceState({ ...base, everConnected: true, connected: 1, dropped: 1 })).toBe('connected');
  });

  it('with every connection down, this member is reconnecting', () => {
    expect(meshVoiceState({ ...base, everConnected: true, dropped: 2 })).toBe('reconnecting');
  });

  it('offline is reconnecting, or connecting before the first connection', () => {
    expect(meshVoiceState({ ...base, online: false, everConnected: true, connected: 2 })).toBe('reconnecting');
    expect(meshVoiceState({ ...base, online: false })).toBe('connecting');
  });
});

describe('server voice disconnects', () => {
  it('leaving on purpose is ignored', () => {
    expect(serverDisconnectAction(LIVEKIT_DISCONNECT.CLIENT_INITIATED, false)).toEqual({ kind: 'ignore' });
    expect(serverDisconnectAction(LIVEKIT_DISCONNECT.SIGNAL_CLOSE, true)).toEqual({ kind: 'ignore' });
  });

  it('the same identity joining elsewhere is final: the room opened somewhere else', () => {
    expect(serverDisconnectAction(LIVEKIT_DISCONNECT.DUPLICATE_IDENTITY, false)).toEqual({
      kind: 'fail',
      code: 'replaced',
    });
  });

  it('removal and a closed room are final', () => {
    for (const reason of [
      LIVEKIT_DISCONNECT.PARTICIPANT_REMOVED,
      LIVEKIT_DISCONNECT.ROOM_DELETED,
      LIVEKIT_DISCONNECT.ROOM_CLOSED,
    ]) {
      expect(serverDisconnectAction(reason, false)).toEqual({ kind: 'fail', code: 'disconnected' });
    }
  });

  it('network and server faults are retried', () => {
    for (const reason of [
      undefined,
      LIVEKIT_DISCONNECT.UNKNOWN_REASON,
      LIVEKIT_DISCONNECT.SIGNAL_CLOSE,
      LIVEKIT_DISCONNECT.SERVER_SHUTDOWN,
      LIVEKIT_DISCONNECT.CONNECTION_TIMEOUT,
      LIVEKIT_DISCONNECT.JOIN_FAILURE,
      LIVEKIT_DISCONNECT.MEDIA_FAILURE,
    ]) {
      expect(serverDisconnectAction(reason, false)).toEqual({ kind: 'retry' });
    }
  });

  it('backs off 1, 2, 4, then 5 seconds', () => {
    expect([0, 1, 2, 3, 10].map(retryDelayMs)).toEqual([1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('stops retrying when the token function refuses the member', () => {
    expect(FINAL_TOKEN_CODES).toEqual(
      expect.arrayContaining(['unauthorized', 'not_member', 'wrong_voice_mode', 'voice_muted']),
    );
    expect(FINAL_TOKEN_CODES).not.toContain('internal');
  });
});
