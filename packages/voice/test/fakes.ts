import type { RtcEvent } from '@watchparty/sync-core';
import type {
  Clock,
  MediaAccess,
  NetworkWatcher,
  PresenceFeed,
  RtcTransport,
  VoicePresence,
} from '../src/types';
import type { LevelMeterFactory } from '../src/speaking';

/** Waits for queued promise callbacks (microtasks) to run. */
export async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Waits for promise callbacks and zero delay tasks, such as negotiationneeded, until things go quiet. */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await flush(50);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export class FakeClock implements Clock {
  t = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void; every?: number }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id;
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Moves time forward, running due timers in order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let nextId: number | null = null;
      let next: { at: number; fn: () => void; every?: number } | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= end && (next === null || timer.at < next.at)) {
          next = timer;
          nextId = id;
        }
      }
      if (next === null || nextId === null) break;
      this.t = next.at;
      if (next.every) next.at += next.every;
      else this.timers.delete(nextId);
      next.fn();
    }
    this.t = end;
  }

  get pending(): number {
    return this.timers.size;
  }
}

let trackCounter = 0;

export class FakeTrack {
  readonly id = `track-${++trackCounter}`;
  enabled = true;
  readyState: 'live' | 'ended' = 'live';
  onended: (() => void) | null = null;
  constructor(readonly kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
  }
}

export class FakeStream {
  readonly id = `stream-${++trackCounter}`;
  private readonly listeners: Array<(ev: { track: FakeTrack }) => void> = [];
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addEventListener(type: string, cb: (ev: { track: FakeTrack }) => void): void {
    if (type === 'removetrack') this.listeners.push(cb);
  }
  removeTrack(track: FakeTrack): void {
    const i = this.tracks.indexOf(track);
    if (i >= 0) this.tracks.splice(i, 1);
    for (const cb of this.listeners) cb({ track });
  }
}

export class FakeMedia implements MediaAccess {
  requests: MediaStreamConstraints[] = [];
  failMic: Error | null = null;
  failCamera: Error | null = null;
  streams: FakeStream[] = [];

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.requests.push(constraints);
    if (constraints.audio && this.failMic) throw this.failMic;
    if (constraints.video && this.failCamera) throw this.failCamera;
    const tracks: FakeTrack[] = [];
    if (constraints.audio) tracks.push(new FakeTrack('audio'));
    if (constraints.video) tracks.push(new FakeTrack('video'));
    const stream = new FakeStream(tracks);
    this.streams.push(stream);
    return stream as unknown as MediaStream;
  }
}

interface FakeSender {
  track: FakeTrack | null;
  replaceTrack(track: FakeTrack | null): Promise<void>;
}

interface FakeTransceiver {
  sender: FakeSender;
  direction: RTCRtpTransceiverDirection;
}

/**
 * Enough of RTCPeerConnection for the handshake: descriptions move through the signalling states,
 * a completed offer and answer marks the connection connected, and the description lists which
 * kinds of track the sender sends so the other side fires `track` events.
 */
export class FakePeerConnection {
  static created: FakePeerConnection[] = [];

  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: { type: RTCSdpType; sdp: string } | null = null;
  remoteDescription: { type: RTCSdpType; sdp: string } | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  readonly transceivers: FakeTransceiver[] = [];
  readonly addedCandidates: unknown[] = [];
  readonly remoteStream = new FakeStream([]);
  readonly remoteTracks = new Map<string, FakeTrack>();
  restarts = 0;
  closed = false;
  autoConnect = true;
  private negotiationQueued = false;
  /** Local changes not yet carried by an offer, as a browser tracks for negotiationneeded. */
  private dirty = false;
  private offeredDirty = false;

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.created.push(this);
  }

  addTrack(track: FakeTrack): FakeSender {
    const sender: FakeSender = {
      track,
      async replaceTrack(t) {
        sender.track = t;
      },
    };
    this.transceivers.push({ sender, direction: 'sendrecv' });
    // A track added while answering joins the offer's media section, so the answer carries it.
    if (this.signalingState !== 'have-remote-offer') this.dirty = true;
    this.queueNegotiation();
    return sender;
  }

  removeTrack(sender: FakeSender): void {
    sender.track = null;
    const t = this.transceivers.find((x) => x.sender === sender);
    if (t) t.direction = 'recvonly';
    this.dirty = true;
    this.queueNegotiation();
  }

  getTransceivers(): FakeTransceiver[] {
    return this.transceivers;
  }

  async setLocalDescription(desc?: { type: RTCSdpType }): Promise<void> {
    if (desc?.type === 'rollback') {
      this.signalingState = 'stable';
      this.localDescription = null;
      this.dirty = this.dirty || this.offeredDirty;
      return;
    }
    if (this.signalingState === 'stable') {
      this.localDescription = { type: 'offer', sdp: this.sdp() };
      this.signalingState = 'have-local-offer';
      this.offeredDirty = this.dirty;
      this.dirty = false;
      this.onicecandidate?.({
        candidate: { candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', toJSON: () => ({ candidate: 'candidate:1 1 udp 1 192.0.2.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 }) },
      });
    } else if (this.signalingState === 'have-remote-offer') {
      this.localDescription = { type: 'answer', sdp: this.sdp() };
      this.signalingState = 'stable';
      this.completed();
    }
  }

  async setRemoteDescription(desc: { type: RTCSdpType; sdp: string }): Promise<void> {
    if (desc.type === 'offer') {
      if (this.signalingState === 'have-local-offer') throw new Error('offer collision without rollback');
      this.signalingState = 'have-remote-offer';
    } else {
      if (this.signalingState !== 'have-local-offer') throw new Error('unexpected answer');
      this.signalingState = 'stable';
      this.completed();
    }
    this.remoteDescription = desc;
    const kinds = (JSON.parse(desc.sdp) as { kinds: Array<'audio' | 'video'> }).kinds;
    for (const kind of ['audio', 'video'] as const) {
      const existing = this.remoteTracks.get(kind);
      if (kinds.includes(kind) && !existing) {
        const track = new FakeTrack(kind);
        this.remoteTracks.set(kind, track);
        this.remoteStream.tracks.push(track);
        this.ontrack?.({ track, streams: [this.remoteStream] });
      } else if (!kinds.includes(kind) && existing) {
        this.remoteTracks.delete(kind);
        this.remoteStream.removeTrack(existing);
      }
    }
  }

  async addIceCandidate(candidate: unknown): Promise<void> {
    this.addedCandidates.push(candidate);
  }

  restartIce(): void {
    this.restarts++;
  }

  close(): void {
    this.closed = true;
    this.signalingState = 'closed';
    this.connectionState = 'closed';
  }

  /** Test hook: change the connection state and fire the event. */
  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  private sdp(): string {
    const kinds = this.transceivers
      .filter((t) => t.sender.track && (t.direction === 'sendrecv' || t.direction === 'sendonly'))
      .map((t) => t.sender.track?.kind);
    return JSON.stringify({ kinds });
  }

  private completed(): void {
    this.offeredDirty = false;
    if (this.dirty) this.queueNegotiation();
    if (!this.autoConnect || this.connectionState === 'connected') return;
    queueMicrotask(() => {
      if (this.closed) return;
      this.setConnectionState('connected');
    });
  }

  private queueNegotiation(): void {
    if (this.negotiationQueued) return;
    this.negotiationQueued = true;
    // Browsers fire negotiationneeded as a task, after pending promise callbacks.
    setTimeout(() => {
      this.negotiationQueued = false;
      if (!this.closed && this.signalingState === 'stable') this.onnegotiationneeded?.();
    }, 0);
  }
}

export const createFakePeerConnection = (config: RTCConfiguration) =>
  new FakePeerConnection(config) as unknown as RTCPeerConnection;

/** The room's client topic: every event reaches every other subscriber, as Supabase broadcast does. */
export class FakeBus {
  readonly sent: RtcEvent[] = [];
  private readonly subscribers = new Map<string, Set<(e: RtcEvent) => void>>();

  transport(userId: string): RtcTransport {
    return {
      send: (event) => {
        this.sent.push(event);
        const copy = JSON.parse(JSON.stringify(event)) as RtcEvent;
        for (const [id, cbs] of this.subscribers) {
          if (id === userId) continue;
          for (const cb of cbs) queueMicrotask(() => cb(copy));
        }
      },
      onEvent: (cb) => {
        const set = this.subscribers.get(userId) ?? new Set();
        set.add(cb);
        this.subscribers.set(userId, set);
        return () => set.delete(cb);
      },
    };
  }

  /** Delivers an event to `userId` as if another member had sent it. */
  deliver(userId: string, event: RtcEvent): void {
    for (const cb of this.subscribers.get(userId) ?? []) cb(event);
  }
}

export class FakePresence implements PresenceFeed {
  private members: VoicePresence[] = [];
  private readonly listeners = new Set<(m: readonly VoicePresence[]) => void>();

  get(): readonly VoicePresence[] {
    return this.members;
  }

  subscribe(cb: (m: readonly VoicePresence[]) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  set(members: VoicePresence[]): void {
    this.members = members;
    for (const cb of this.listeners) cb(members);
  }
}

export class FakeNetwork implements NetworkWatcher {
  online = true;
  private readonly listeners = new Set<(online: boolean) => void>();
  isOnline(): boolean {
    return this.online;
  }
  onChange(cb: (online: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  change(online: boolean): void {
    this.online = online;
    for (const cb of this.listeners) cb(online);
  }
}

export class FakeAudioContext {
  state: AudioContextState = 'suspended';
  resumed = 0;
  async resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
  }
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
}

/** Level meters whose level each test sets per track id. */
export function fakeMeters(): { factory: LevelMeterFactory; levels: Map<string, number> } {
  const levels = new Map<string, number>();
  return {
    levels,
    factory: (_context, track) => ({
      level: () => levels.get(track.id) ?? Number.NEGATIVE_INFINITY,
      dispose: () => {},
    }),
  };
}
