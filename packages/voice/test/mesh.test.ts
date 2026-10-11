import { beforeEach, describe, expect, it } from 'vitest';
import type { RtcEvent } from '@watchparty/sync-core';
import { CAMERA_CONSTRAINTS, MIC_CONSTRAINTS } from '../src/media';
import { DISCONNECTED_RESTART_MS, MeshVoice, PRESENCE_CLOSE_GRACE_MS } from '../src/mesh';
import { RECONNECT_WINDOW_MS } from '../src/reconnect';
import { VoiceError, type VoiceState, type VoiceTracks } from '../src/types';
import {
  FakeAudioContext,
  FakeBus,
  FakeClock,
  FakeMedia,
  FakeNetwork,
  FakePeerConnection,
  FakePresence,
  type FakeTrack,
  fakeMeters,
  settle,
} from './fakes';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const ROOM = '99999999-9999-4999-8999-999999999999';
const LABELS: Record<string, string> = { [A]: 'A', [B]: 'B', [C]: 'C' };

interface World {
  bus: FakeBus;
  presence: FakePresence;
  clock: FakeClock;
  network: FakeNetwork;
}

function world(): World {
  return { bus: new FakeBus(), presence: new FakePresence(), clock: new FakeClock(), network: new FakeNetwork() };
}

function client(userId: string, w: World, opts: { getIceServers?: () => Promise<RTCIceServer[]> } = {}) {
  const media = new FakeMedia();
  const meters = fakeMeters();
  const context = new FakeAudioContext();
  const pcs: FakePeerConnection[] = [];
  let contextsCreated = 0;
  let ids = 0;
  const voice = new MeshVoice({
    getIceServers: opts.getIceServers ?? (async () => [{ urls: 'stun:stun.cloudflare.com:3478' }]),
    signalling: w.bus.transport(userId),
    presence: w.presence,
    media,
    createPeerConnection: (config) => {
      const pc = new FakePeerConnection(config);
      pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    createAudioContext: () => {
      contextsCreated++;
      return context as unknown as AudioContext;
    },
    createLevelMeter: meters.factory,
    network: w.network,
    clock: w.clock,
    newId: () => `${LABELS[userId] ?? 'X'}-${++ids}`,
    log: () => {},
  });
  const states: VoiceState[] = [];
  const tracks = new Map<string, VoiceTracks>();
  const speaking: Array<[string, boolean]> = [];
  const errors: string[] = [];
  voice.onState((s) => states.push(s));
  voice.onTracks((id, t) => tracks.set(id, t));
  voice.onSpeaking((id, s) => speaking.push([id, s]));
  voice.onError((e) => errors.push(e.code));
  const micTrack = () => media.streams[0]?.tracks[0] as FakeTrack | undefined;
  return {
    voice,
    media,
    meters,
    context,
    pcs,
    states,
    tracks,
    speaking,
    errors,
    micTrack,
    contexts: () => contextsCreated,
    join: () => voice.join({ roomId: ROOM, userId }),
  };
}


function sentBy(bus: FakeBus, from: string, kind?: RtcEvent['kind']): RtcEvent[] {
  return bus.sent.filter((e) => e.from === from && (kind === undefined || e.kind === kind));
}

async function connectedPair(w = world()) {
  const a = client(A, w);
  const b = client(B, w);
  await a.join();
  await b.join();
  await settle();
  return { w, a, b };
}

beforeEach(() => {
  FakePeerConnection.created = [];
});

describe('joining', () => {
  it('creates and resumes the audio context synchronously inside the tap, before any await', () => {
    const w = world();
    const a = client(A, w);
    const pending = a.join();
    expect(a.contexts()).toBe(1);
    expect(a.context.resumed).toBe(1);
    return pending;
  });

  it('asks for the microphone with echo cancellation, noise suppression and auto gain control', async () => {
    const w = world();
    const a = client(A, w);
    await a.join();
    expect(a.media.requests[0]).toEqual({ audio: MIC_CONSTRAINTS, video: false });
    expect(MIC_CONSTRAINTS).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
  });

  it('sends hello with to null and is connected while alone', async () => {
    const w = world();
    const a = client(A, w);
    await a.join();
    expect(sentBy(w.bus, A)).toEqual([{ from: A, to: null, kind: 'hello', payload: { session: 'A-1' } }]);
    expect(a.states).toEqual(['connecting', 'connected']);
    expect(a.voice.getLocalMedia()).toEqual({ micEnabled: true, cameraEnabled: false, hostMuted: false });
  });

  it('fails with the function code when turn-credentials refuses the member', async () => {
    const w = world();
    const a = client(A, w, {
      getIceServers: async () => {
        throw new VoiceError('voice_muted');
      },
    });
    await expect(a.join()).rejects.toMatchObject({ code: 'voice_muted' });
    expect(a.states).toEqual(['connecting', 'failed']);
    expect(a.errors).toEqual(['voice_muted']);
    expect(a.micTrack()?.readyState).toBe('ended');
  });

  it('reports a refused microphone as mic_denied', async () => {
    const w = world();
    const a = client(A, w);
    a.media.failMic = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    await expect(a.join()).rejects.toMatchObject({ code: 'mic_denied' });
    expect(a.errors).toEqual(['mic_denied']);
  });

  it('passes the ICE servers from turn-credentials to every connection', async () => {
    const w = world();
    const servers = [{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }];
    const a = client(A, w, { getIceServers: async () => servers });
    await a.join();
    w.bus.deliver(A, { from: B, to: null, kind: 'hello', payload: { session: 'B-1' } });
    await settle();
    expect(a.pcs[0]?.config).toEqual({ iceServers: servers });
  });
});

describe('handshake', () => {
  it('the smaller id creates the connection and offers on hello from the larger id', async () => {
    const w = world();
    const a = client(A, w);
    await a.join();
    w.bus.deliver(A, { from: B, to: null, kind: 'hello', payload: { session: 'B-1' } });
    await settle();
    expect(a.pcs).toHaveLength(1);
    expect(sentBy(w.bus, A, 'hello').at(-1)).toEqual({ from: A, to: B, kind: 'hello', payload: { session: 'A-1' } });
    const offer = sentBy(w.bus, A, 'description')[0];
    expect(offer?.to).toBe(B);
    expect((offer?.payload as { description: { type: string } }).description.type).toBe('offer');
  });

  it('the larger id replies with a directed hello and waits for the offer', async () => {
    const w = world();
    const b = client(B, w);
    await b.join();
    w.bus.deliver(B, { from: A, to: null, kind: 'hello', payload: { session: 'A-1' } });
    await settle();
    expect(b.pcs).toHaveLength(0);
    expect(sentBy(w.bus, B, 'hello').at(-1)).toEqual({ from: B, to: A, kind: 'hello', payload: { session: 'B-1' } });
    expect(sentBy(w.bus, B, 'description')).toEqual([]);
  });

  it('does not answer a directed hello with another hello', async () => {
    const w = world();
    const b = client(B, w);
    await b.join();
    const before = sentBy(w.bus, B).length;
    w.bus.deliver(B, { from: A, to: B, kind: 'hello', payload: { session: 'A-1' } });
    await settle();
    expect(sentBy(w.bus, B)).toHaveLength(before);
  });

  it('ignores events for someone else, its own events and invalid events', async () => {
    const w = world();
    const a = client(A, w);
    await a.join();
    const before = w.bus.sent.length;
    w.bus.deliver(A, { from: B, to: C, kind: 'hello', payload: { session: 'B-1' } });
    w.bus.deliver(A, { from: A, to: null, kind: 'hello', payload: { session: 'A-9' } });
    w.bus.deliver(A, { from: B, to: A, kind: 'description', payload: { nonsense: true } });
    w.bus.deliver(A, { from: 'not-a-uuid', to: null, kind: 'hello', payload: { session: 'x' } } as RtcEvent);
    await settle();
    expect(w.bus.sent).toHaveLength(before);
    expect(a.pcs).toHaveLength(0);
  });

  it('two members connect, hear each other and both reach connected', async () => {
    const { a, b } = await connectedPair();
    expect(a.pcs).toHaveLength(1);
    expect(b.pcs).toHaveLength(1);
    expect(a.voice.getState()).toBe('connected');
    expect(b.states).toEqual(['connecting', 'connected']);
    expect(a.tracks.get(B)?.audio).toBeDefined();
    expect(b.tracks.get(A)?.audio).toBeDefined();
    expect(a.pcs[0]?.signalingState).toBe('stable');
    expect(b.pcs[0]?.signalingState).toBe('stable');
  });

  it('three members form a full mesh of three connections', async () => {
    const w = world();
    const a = client(A, w);
    const b = client(B, w);
    const c = client(C, w);
    await a.join();
    await b.join();
    await c.join();
    await settle();
    expect(a.pcs).toHaveLength(2);
    expect(b.pcs).toHaveLength(2);
    expect(c.pcs).toHaveLength(2);
    for (const x of [a, b, c]) expect(x.voice.getState()).toBe('connected');
    expect([...c.tracks.keys()].sort()).toEqual([A, B]);
  });

  it('presence starts the connection from the smaller id, and the offer is sent again once the peer says hello', async () => {
    const w = world();
    const a = client(A, w);
    const b = client(B, w);
    await a.join();
    w.presence.set([
      { user_id: A, voice: 'live' },
      { user_id: B, voice: 'live' },
    ]);
    await settle();
    expect(a.pcs).toHaveLength(1);
    // B was not listening yet, so the first offer was lost.
    await b.join();
    await settle();
    expect(b.voice.getState()).toBe('connected');
    expect(b.tracks.get(A)?.audio).toBeDefined();
    expect(a.pcs).toHaveLength(1);
  });

  it('closes the connection when the peer leaves voice according to presence', async () => {
    const { w, a } = await connectedPair();
    w.presence.set([
      { user_id: A, voice: 'live' },
      { user_id: B, voice: 'live' },
    ]);
    w.presence.set([
      { user_id: A, voice: 'live' },
      { user_id: B, voice: 'off' },
    ]);
    // Presence flickers, so the close waits for the grace period.
    expect(a.pcs[0]?.closed).toBe(false);
    w.clock.advance(PRESENCE_CLOSE_GRACE_MS);
    expect(a.pcs[0]?.closed).toBe(true);
    expect(a.tracks.get(B)).toEqual({});
  });

  it('keeps the connection when presence only flickers', async () => {
    const { w, a } = await connectedPair();
    w.presence.set([{ user_id: A, voice: 'live' }]);
    w.clock.advance(PRESENCE_CLOSE_GRACE_MS / 2);
    w.presence.set([
      { user_id: A, voice: 'live' },
      { user_id: B, voice: 'live' },
    ]);
    w.clock.advance(PRESENCE_CLOSE_GRACE_MS);
    expect(a.pcs[0]?.closed).toBe(false);
    expect(a.pcs).toHaveLength(1);
  });

  it('a member who rejoins voice gets a fresh connection', async () => {
    const { a, b } = await connectedPair();
    await b.voice.leave();
    expect(b.pcs[0]?.closed).toBe(true);
    await b.join();
    await settle();
    expect(a.pcs).toHaveLength(2);
    expect(a.pcs[0]?.closed).toBe(true);
    expect(a.pcs[1]?.connectionState).toBe('connected');
    expect(b.voice.getState()).toBe('connected');
  });
});

describe('camera and renegotiation', () => {
  it('turns the camera on at 320 by 240 and 15 fps, and the other member gets the video', async () => {
    const { a, b } = await connectedPair();
    await a.voice.setCameraEnabled(true);
    await settle();
    expect(a.media.requests.at(-1)).toEqual({ audio: false, video: CAMERA_CONSTRAINTS });
    expect(CAMERA_CONSTRAINTS.width).toEqual({ ideal: 320 });
    expect(CAMERA_CONSTRAINTS.height).toEqual({ ideal: 240 });
    expect(CAMERA_CONSTRAINTS.frameRate).toEqual({ ideal: 15, max: 15 });
    expect(a.tracks.get(A)?.video).toBeDefined();
    expect(b.tracks.get(A)?.video).toBeDefined();
    expect(a.voice.getLocalMedia().cameraEnabled).toBe(true);

    await a.voice.setCameraEnabled(false);
    await settle();
    expect(b.tracks.get(A)?.video).toBeUndefined();
    expect(b.tracks.get(A)?.audio).toBeDefined();
    expect(a.tracks.get(A)).toEqual({});
  });

  it('the camera is off by default', async () => {
    const { a } = await connectedPair();
    expect(a.voice.getLocalMedia().cameraEnabled).toBe(false);
    expect(a.media.requests.every((r) => !r.video)).toBe(true);
  });

  it('when both members renegotiate at once, the polite smaller id rolls back and both end up with video', async () => {
    const { a, b } = await connectedPair();
    await Promise.all([a.voice.setCameraEnabled(true), b.voice.setCameraEnabled(true)]);
    await settle();
    expect(a.tracks.get(B)?.video).toBeDefined();
    expect(b.tracks.get(A)?.video).toBeDefined();
    expect(a.pcs[0]?.signalingState).toBe('stable');
    expect(b.pcs[0]?.signalingState).toBe('stable');
  });
});

describe('moderation', () => {
  it('stops playing a muted member and plays them again after unmute', async () => {
    const { a } = await connectedPair();
    const remote = a.pcs[0]?.remoteTracks.get('audio');
    a.voice.handleModeration({ target: B, action: 'mute_voice' });
    expect(a.tracks.get(B)).toEqual({});
    expect(remote?.enabled).toBe(false);
    expect(a.pcs[0]?.closed).toBe(false);
    a.voice.handleModeration({ target: B, action: 'unmute_voice' });
    expect(a.tracks.get(B)?.audio).toBe(remote);
    expect(remote?.enabled).toBe(true);
  });

  it('closes the connection to a removed member and ignores their signalling afterwards', async () => {
    const { w, a } = await connectedPair();
    a.voice.handleModeration({ target: B, action: 'remove', new_epoch: 2 } as never);
    expect(a.pcs[0]?.closed).toBe(true);
    expect(a.tracks.get(B)).toEqual({});
    const before = w.bus.sent.length;
    w.bus.deliver(A, { from: B, to: null, kind: 'hello', payload: { session: 'B-9' } });
    await settle();
    expect(w.bus.sent).toHaveLength(before);
    expect(a.pcs).toHaveLength(1);
  });

  it('a banned member stays blocked even when presence shows them in voice', async () => {
    const { w, a } = await connectedPair();
    a.voice.handleModeration({ target: B, action: 'ban' });
    w.presence.set([{ user_id: B, voice: 'live' }]);
    await settle();
    expect(a.pcs).toHaveLength(1);
  });

  it('the muted member stops sending and cannot unmute until the host unmutes them', async () => {
    const { b } = await connectedPair();
    b.voice.handleModeration({ target: B, action: 'mute_voice' });
    await settle();
    expect(b.pcs[0]?.transceivers[0]?.sender.track).toBeNull();
    expect(b.micTrack()?.enabled).toBe(false);
    expect(b.voice.getLocalMedia()).toEqual({ micEnabled: false, cameraEnabled: false, hostMuted: true });
    await expect(b.voice.setMicEnabled(true)).rejects.toMatchObject({ code: 'host_muted' });
    await expect(b.voice.setCameraEnabled(true)).rejects.toMatchObject({ code: 'host_muted' });

    b.voice.handleModeration({ target: B, action: 'unmute_voice' });
    await settle();
    expect(b.pcs[0]?.transceivers[0]?.sender.track).toBe(b.micTrack());
    expect(b.voice.getLocalMedia()).toEqual({ micEnabled: false, cameraEnabled: false, hostMuted: false });
    await b.voice.setMicEnabled(true);
    expect(b.micTrack()?.enabled).toBe(true);
  });

  it('a host mute reported before join keeps the microphone off', async () => {
    const w = world();
    const b = client(B, w);
    b.voice.handleModeration({ target: B, action: 'mute_voice' });
    await b.join();
    expect(b.voice.getLocalMedia().hostMuted).toBe(true);
    expect(b.micTrack()?.enabled).toBe(false);
  });

  it('a removed or banned member leaves voice', async () => {
    const { b } = await connectedPair();
    b.voice.handleModeration({ target: B, action: 'ban' });
    await settle();
    expect(b.voice.getState()).toBe('idle');
    expect(b.pcs[0]?.closed).toBe(true);
    expect(b.micTrack()?.readyState).toBe('ended');
  });
});

describe('network changes and reconnecting', () => {
  it('restarts ICE on every connection after a network change', async () => {
    const w = world();
    const a = client(A, w);
    const b = client(B, w);
    const c = client(C, w);
    await a.join();
    await b.join();
    await c.join();
    await settle();
    w.network.change(true);
    expect(a.pcs.map((pc) => pc.restarts)).toEqual([1, 1]);
    expect(b.pcs.map((pc) => pc.restarts)).toEqual([1, 1]);
  });

  it('restarts ICE when a connection fails, and after a short wait when it is disconnected', async () => {
    const { w, a } = await connectedPair();
    const pc = a.pcs[0] as FakePeerConnection;
    pc.iceConnectionState = 'failed';
    pc.oniceconnectionstatechange?.();
    expect(pc.restarts).toBe(1);
    pc.setConnectionState('disconnected');
    w.clock.advance(DISCONNECTED_RESTART_MS);
    expect(pc.restarts).toBe(2);
  });

  it('shows reconnecting while every connection is down and recovers inside 30 seconds', async () => {
    const { w, a } = await connectedPair();
    const pc = a.pcs[0] as FakePeerConnection;
    pc.setConnectionState('disconnected');
    expect(a.voice.getState()).toBe('reconnecting');
    w.clock.advance(20_000);
    pc.setConnectionState('connected');
    expect(a.voice.getState()).toBe('connected');
    w.clock.advance(RECONNECT_WINDOW_MS);
    expect(a.voice.getState()).toBe('connected');
  });

  it('fails after 30 seconds of reconnecting and releases the microphone', async () => {
    const { w, a } = await connectedPair();
    const pc = a.pcs[0] as FakePeerConnection;
    pc.setConnectionState('failed');
    expect(a.voice.getState()).toBe('reconnecting');
    w.clock.advance(RECONNECT_WINDOW_MS - 1);
    expect(a.voice.getState()).toBe('reconnecting');
    w.clock.advance(1);
    expect(a.voice.getState()).toBe('failed');
    expect(a.errors).toEqual(['disconnected']);
    expect(pc.closed).toBe(true);
    expect(a.micTrack()?.readyState).toBe('ended');
  });

  it('going offline counts as reconnecting', async () => {
    const { w, a } = await connectedPair();
    w.network.change(false);
    expect(a.voice.getState()).toBe('reconnecting');
    w.network.change(true);
    expect(a.voice.getState()).toBe('connected');
  });

  it('can rejoin after failing', async () => {
    const { w, a } = await connectedPair();
    (a.pcs[0] as FakePeerConnection).setConnectionState('failed');
    w.clock.advance(RECONNECT_WINDOW_MS);
    expect(a.voice.getState()).toBe('failed');
    await a.join();
    await settle();
    expect(a.voice.getState()).toBe('connected');
  });
});

describe('speaking', () => {
  it('fires for the local microphone and for remote tracks after 150 ms above the threshold', async () => {
    const { w, a } = await connectedPair();
    a.meters.levels.set(a.micTrack()?.id ?? '', -20);
    const remote = a.pcs[0]?.remoteTracks.get('audio');
    a.meters.levels.set(remote?.id ?? '', -20);
    w.clock.advance(150);
    expect(a.speaking).toEqual([]);
    w.clock.advance(50);
    expect(a.speaking).toEqual(
      expect.arrayContaining([
        [A, true],
        [B, true],
      ]),
    );
  });

  it('a muted microphone does not count as speaking', async () => {
    const { w, a } = await connectedPair();
    a.meters.levels.set(a.micTrack()?.id ?? '', -20);
    await a.voice.setMicEnabled(false);
    w.clock.advance(1_000);
    expect(a.speaking).toEqual([]);
  });

  it('a member muted by the host is not reported as speaking', async () => {
    const { w, a } = await connectedPair();
    a.voice.handleModeration({ target: B, action: 'mute_voice' });
    a.meters.levels.set(a.pcs[0]?.remoteTracks.get('audio')?.id ?? '', -20);
    w.clock.advance(1_000);
    expect(a.speaking).toEqual([]);
  });
});

describe('leaving', () => {
  it('closes connections, stops tracks and reports remote tracks gone', async () => {
    const { a } = await connectedPair();
    await a.voice.leave();
    expect(a.voice.getState()).toBe('idle');
    expect(a.pcs[0]?.closed).toBe(true);
    expect(a.micTrack()?.readyState).toBe('ended');
    expect(a.tracks.get(B)).toEqual({});
    expect(a.context.state).toBe('suspended');
  });
});
