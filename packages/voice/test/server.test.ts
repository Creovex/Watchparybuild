import { beforeEach, describe, expect, it } from 'vitest';
import { MIC_CONSTRAINTS } from '../src/media';
import { LIVEKIT_DISCONNECT, RECONNECT_WINDOW_MS } from '../src/reconnect';
import { ServerVoice, diffSpeakers, type LiveKitModule } from '../src/server';
import { VoiceError, type VoiceState, type VoiceTracks } from '../src/types';
import { FakeAudioContext, FakeClock, FakeTrack, flush } from './fakes';

const ME = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ROOM = '99999999-9999-4999-8999-999999999999';

type Handler = (...args: unknown[]) => void;

class Emitter {
  private readonly handlers = new Map<string, Handler[]>();
  on(event: string, fn: Handler): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}

function fakeTrackPublication(kind: 'audio' | 'video') {
  const mediaStreamTrack = new FakeTrack(kind);
  return {
    isMuted: false,
    subscribed: true,
    track: { mediaStreamTrack, attach: (el: unknown) => el, detach: (el: unknown) => el },
    setSubscribed(on: boolean) {
      this.subscribed = on;
    },
  };
}

class FakeLocalParticipant {
  identity = ME;
  permissions = { canPublish: true };
  calls: unknown[][] = [];
  publications = new Map<string, ReturnType<typeof fakeTrackPublication>>();
  async setMicrophoneEnabled(on: boolean, options?: unknown) {
    this.calls.push(['mic', on, options]);
  }
  async setCameraEnabled(on: boolean, capture?: unknown, publish?: unknown) {
    this.calls.push(['camera', on, capture, publish]);
    if (on) this.publications.set('camera', fakeTrackPublication('video'));
    else this.publications.delete('camera');
  }
  getTrackPublication(source: string) {
    return this.publications.get(source);
  }
}

class FakeRemoteParticipant {
  publications = new Map<string, ReturnType<typeof fakeTrackPublication>>();
  constructor(readonly identity: string) {
    this.publications.set('microphone', fakeTrackPublication('audio'));
  }
  get trackPublications() {
    return this.publications;
  }
  getTrackPublication(source: string) {
    return this.publications.get(source);
  }
}

class FakeRoom extends Emitter {
  static created: FakeRoom[] = [];
  static failConnect = 0;
  localParticipant = new FakeLocalParticipant();
  remoteParticipants = new Map<string, FakeRemoteParticipant>();
  connectedWith: [string, string] | null = null;
  disconnected = false;
  constructor(readonly options: Record<string, unknown>) {
    super();
    FakeRoom.created.push(this);
  }
  async connect(url: string, token: string) {
    if (FakeRoom.failConnect > 0) {
      FakeRoom.failConnect--;
      throw new Error('could not reach LiveKit');
    }
    this.connectedWith = [url, token];
  }
  async disconnect() {
    this.disconnected = true;
  }
  addRemote(id: string): FakeRemoteParticipant {
    const p = new FakeRemoteParticipant(id);
    this.remoteParticipants.set(id, p);
    this.emit('trackSubscribed', p.publications.get('microphone')?.track, p.publications.get('microphone'), p);
    return p;
  }
}

const fakeLiveKit = {
  Room: FakeRoom,
  RoomEvent: {
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
    Disconnected: 'disconnected',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackMuted: 'trackMuted',
    TrackUnmuted: 'trackUnmuted',
    ParticipantDisconnected: 'participantDisconnected',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    LocalTrackUnpublished: 'localTrackUnpublished',
    ParticipantPermissionsChanged: 'participantPermissionsChanged',
    MediaDevicesError: 'mediaDevicesError',
  },
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
} as unknown as LiveKitModule;

function setup(tokens: Array<() => Promise<{ url: string; token: string }>> = []) {
  const clock = new FakeClock();
  const context = new FakeAudioContext();
  let tokenCalls = 0;
  let loads = 0;
  const voice = new ServerVoice({
    getToken: () => {
      const n = tokenCalls++;
      const next = tokens[n] ?? (async () => ({ url: 'wss://lk.example', token: `token-${n}` }));
      return next();
    },
    loadLiveKit: async () => {
      loads++;
      return fakeLiveKit;
    },
    createAudioContext: () => context as unknown as AudioContext,
    clock,
    log: () => {},
  });
  const states: VoiceState[] = [];
  const speaking: Array<[string, boolean]> = [];
  const tracks = new Map<string, VoiceTracks>();
  const errors: string[] = [];
  voice.onState((s) => states.push(s));
  voice.onSpeaking((id, s) => speaking.push([id, s]));
  voice.onTracks((id, t) => tracks.set(id, t));
  voice.onError((e) => errors.push(e.code));
  return {
    voice,
    clock,
    context,
    states,
    speaking,
    tracks,
    errors,
    tokenCalls: () => tokenCalls,
    loads: () => loads,
    room: () => FakeRoom.created.at(-1) as FakeRoom,
    join: () => voice.join({ roomId: ROOM, userId: ME }),
  };
}

beforeEach(() => {
  FakeRoom.created = [];
  FakeRoom.failConnect = 0;
});

describe('server voice', () => {
  it('joins with a token, adaptive stream and dynacast on, and the microphone published', async () => {
    const s = setup();
    const pending = s.join();
    expect(s.context.resumed).toBe(1);
    await pending;
    const room = s.room();
    expect(room.options).toMatchObject({ adaptiveStream: true, dynacast: true });
    expect(room.connectedWith).toEqual(['wss://lk.example', 'token-0']);
    expect(room.localParticipant.calls[0]).toEqual(['mic', true, MIC_CONSTRAINTS]);
    expect(s.states).toEqual(['connecting', 'connected']);
  });

  it('loads livekit-client only when joining', async () => {
    const s = setup();
    expect(s.loads()).toBe(0);
    await s.join();
    expect(s.loads()).toBe(1);
  });

  it('reports speaking from active speaker events, the local user included', async () => {
    const s = setup();
    await s.join();
    const room = s.room();
    room.emit('activeSpeakersChanged', [{ identity: ME }, { identity: B }]);
    room.emit('activeSpeakersChanged', [{ identity: B }]);
    room.emit('activeSpeakersChanged', []);
    expect(s.speaking).toEqual([
      [ME, true],
      [B, true],
      [ME, false],
      [B, false],
    ]);
  });

  it('turns the camera on with simulcast at 320 by 240 and 15 fps', async () => {
    const s = setup();
    await s.join();
    await s.voice.setCameraEnabled(true);
    const call = s.room().localParticipant.calls.at(-1);
    expect(call).toEqual([
      'camera',
      true,
      { resolution: { width: 320, height: 240, frameRate: 15 }, facingMode: 'user' },
      { simulcast: true },
    ]);
    expect(s.tracks.get(ME)?.video).toBeDefined();
    await s.voice.setCameraEnabled(false);
    expect(s.tracks.get(ME)).toEqual({});
  });

  it('reports remote tracks as they are subscribed', async () => {
    const s = setup();
    await s.join();
    s.room().addRemote(B);
    expect(s.tracks.get(B)?.audio).toBeDefined();
  });

  it('fetches a new token for every reconnect after a disconnect', async () => {
    const s = setup();
    await s.join();
    s.room().emit('disconnected', LIVEKIT_DISCONNECT.SIGNAL_CLOSE);
    expect(s.voice.getState()).toBe('reconnecting');
    s.clock.advance(1_000);
    await flush();
    expect(s.tokenCalls()).toBe(2);
    expect(FakeRoom.created).toHaveLength(2);
    expect(s.room().connectedWith).toEqual(['wss://lk.example', 'token-1']);
    expect(s.voice.getState()).toBe('connected');
  });

  it('keeps retrying with backoff while LiveKit is unreachable, then fails after 30 seconds', async () => {
    const s = setup();
    await s.join();
    FakeRoom.failConnect = 100;
    s.room().emit('disconnected', LIVEKIT_DISCONNECT.CONNECTION_TIMEOUT);
    for (let t = 0; t < RECONNECT_WINDOW_MS - 1_000; t += 500) {
      s.clock.advance(500);
      await flush();
    }
    expect(s.voice.getState()).toBe('reconnecting');
    s.clock.advance(1_000);
    await flush();
    expect(s.voice.getState()).toBe('failed');
    expect(s.errors).toEqual(['disconnected']);
    const attempts = s.tokenCalls();
    s.clock.advance(60_000);
    await flush();
    expect(s.tokenCalls()).toBe(attempts);
  });

  it("follows LiveKit's own reconnect, and fails if it takes longer than 30 seconds", async () => {
    const s = setup();
    await s.join();
    const room = s.room();
    room.emit('reconnecting');
    expect(s.voice.getState()).toBe('reconnecting');
    room.emit('reconnected');
    expect(s.voice.getState()).toBe('connected');
    room.emit('reconnecting');
    s.clock.advance(RECONNECT_WINDOW_MS);
    expect(s.voice.getState()).toBe('failed');
    expect(room.disconnected).toBe(true);
  });

  it('the same identity joining elsewhere ends voice here as replaced', async () => {
    const s = setup();
    await s.join();
    s.room().emit('disconnected', LIVEKIT_DISCONNECT.DUPLICATE_IDENTITY);
    expect(s.voice.getState()).toBe('failed');
    expect(s.errors).toEqual(['replaced']);
  });

  it('does not retry when the token function refuses the member', async () => {
    const s = setup([
      async () => {
        throw new VoiceError('not_member');
      },
    ]);
    await expect(s.join()).rejects.toMatchObject({ code: 'not_member' });
    expect(s.voice.getState()).toBe('failed');
    s.clock.advance(10_000);
    await flush();
    expect(s.tokenCalls()).toBe(1);
  });

  it('retries a token request that failed for another reason', async () => {
    const s = setup([
      async () => {
        throw new VoiceError('internal');
      },
    ]);
    await s.join();
    expect(s.voice.getState()).toBe('connecting');
    s.clock.advance(1_000);
    await flush();
    expect(s.voice.getState()).toBe('connected');
  });

  it('stops playing a muted member and their speaking; resumes after unmute', async () => {
    const s = setup();
    await s.join();
    const room = s.room();
    const peer = room.addRemote(B);
    s.voice.handleModeration({ target: B, action: 'mute_voice' });
    expect(s.tracks.get(B)).toEqual({});
    expect(peer.publications.get('microphone')?.subscribed).toBe(false);
    room.emit('activeSpeakersChanged', [{ identity: B }]);
    expect(s.speaking).toEqual([]);
    s.voice.handleModeration({ target: B, action: 'unmute_voice' });
    expect(peer.publications.get('microphone')?.subscribed).toBe(true);
  });

  it('a member muted by the host stops publishing and cannot unmute', async () => {
    const s = setup();
    await s.join();
    s.voice.handleModeration({ target: ME, action: 'mute_voice' });
    expect(s.room().localParticipant.calls).toContainEqual(['mic', false, undefined]);
    expect(s.voice.getLocalMedia()).toEqual({ micEnabled: false, cameraEnabled: false, hostMuted: true });
    await expect(s.voice.setMicEnabled(true)).rejects.toMatchObject({ code: 'host_muted' });
  });

  it('a removed member leaves voice', async () => {
    const s = setup();
    await s.join();
    s.voice.handleModeration({ target: ME, action: 'remove' });
    await flush();
    expect(s.voice.getState()).toBe('idle');
    expect(s.room().disconnected).toBe(true);
  });

  it('leave disconnects and ignores the disconnect event that follows', async () => {
    const s = setup();
    await s.join();
    const room = s.room();
    await s.voice.leave();
    room.emit('disconnected', LIVEKIT_DISCONNECT.CLIENT_INITIATED);
    s.clock.advance(10_000);
    await flush();
    expect(room.disconnected).toBe(true);
    expect(s.voice.getState()).toBe('idle');
    expect(s.tokenCalls()).toBe(1);
  });
});

describe('active speaker changes', () => {
  it('lists who started and who stopped speaking', () => {
    expect(diffSpeakers(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual([
      ['a', false],
      ['c', true],
    ]);
    expect(diffSpeakers(new Set(), new Set())).toEqual([]);
  });
});
