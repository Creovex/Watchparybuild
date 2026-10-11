import { describe, expect, it } from 'vitest';
import { createVoiceClient, type VoiceDeps } from '../src/factory';
import { MeshVoice } from '../src/mesh';
import { presenceVoice } from '../src/media';
import { ServerVoice } from '../src/server';
import { FakeBus, FakePresence } from './fakes';

function deps(): VoiceDeps & { loads: () => number } {
  let loads = 0;
  return {
    getIceServers: async () => [],
    getToken: async () => ({ url: 'wss://lk.example', token: 't' }),
    signalling: new FakeBus().transport('me'),
    presence: new FakePresence(),
    loadLiveKit: async () => {
      loads++;
      throw new Error('not in this test');
    },
    log: () => {},
    loads: () => loads,
  };
}

describe('createVoiceClient', () => {
  it('mesh rooms get mesh voice', () => {
    expect(createVoiceClient('mesh', deps())).toBeInstanceOf(MeshVoice);
  });

  it('server rooms get server voice, without loading LiveKit before join', () => {
    const d = deps();
    expect(createVoiceClient('server', d)).toBeInstanceOf(ServerVoice);
    expect(d.loads()).toBe(0);
  });

  it('refuses an unknown voice mode', () => {
    expect(() => createVoiceClient('p2p' as never, deps())).toThrow(/unknown voice mode/);
  });

  it('both start idle with nothing sent', () => {
    for (const mode of ['mesh', 'server'] as const) {
      const v = createVoiceClient(mode, deps());
      expect(v.getState()).toBe('idle');
      expect(v.getLocalMedia()).toEqual({ micEnabled: false, cameraEnabled: false, hostMuted: false });
    }
  });
});

describe('presence voice', () => {
  it('is off outside voice, muted when the mic is off or the host muted, live otherwise', () => {
    const live = { micEnabled: true, cameraEnabled: false, hostMuted: false };
    expect(presenceVoice('idle', live)).toBe('off');
    expect(presenceVoice('failed', live)).toBe('off');
    expect(presenceVoice('connected', live)).toBe('live');
    expect(presenceVoice('reconnecting', { ...live, micEnabled: false })).toBe('muted');
    expect(presenceVoice('connecting', { ...live, hostMuted: true })).toBe('muted');
  });
});
