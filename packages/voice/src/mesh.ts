import { RtcEvent } from '@watchparty/sync-core';
import {
  CandidatePayload,
  DescriptionPayload,
  HelloPayload,
  decideDescription,
  decideHello,
  decidePresence,
  isForMe,
  isInVoice,
  isPolite,
  routeDescription,
  type PresenceVoice,
} from './handshake';
import { VoiceBase, type VoiceBaseDeps } from './base';
import { CAMERA_CONSTRAINTS, MIC_CONSTRAINTS } from './media';
import { ReconnectWindow, meshVoiceState } from './reconnect';
import { attachTrack, browserMedia, browserNetwork, mediaError, stopStream, toVoiceError } from './runtime';
import {
  DEFAULT_SPEAKING_OPTIONS,
  SpeakingMonitor,
  type LevelMeterFactory,
  type SpeakingOptions,
} from './speaking';
import {
  VoiceError,
  type LocalMedia,
  type MediaAccess,
  type NetworkWatcher,
  type PresenceFeed,
  type RoomVoiceClient,
  type RtcTransport,
  type VoiceModeration,
  type VoicePresence,
  type VoiceTracks,
} from './types';

export interface MeshVoiceDeps extends VoiceBaseDeps {
  /** ICE servers for this room; the web app calls the `turn-credentials` Edge Function. */
  getIceServers(): Promise<RTCIceServer[]>;
  /** The `rtc` event on the room's client topic. */
  signalling: RtcTransport;
  /** Presence on the room's client topic. */
  presence: PresenceFeed;
  media?: MediaAccess;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  createLevelMeter?: LevelMeterFactory;
  network?: NetworkWatcher;
  /** Random ids for voice sessions and connections. */
  newId?: () => string;
  speaking?: Partial<SpeakingOptions>;
}

/** After a connection reports `disconnected`, wait this long for it to recover before restarting ICE. */
export const DISCONNECTED_RESTART_MS = 2_000;

type PeerStatus = 'pending' | 'connected' | 'dropped';

interface Peer {
  id: string;
  /** Connection id, shared by both ends of this RTCPeerConnection pair. */
  conn: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswerPending: boolean;
  everConnected: boolean;
  status: PeerStatus;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  remoteAudio: MediaStreamTrack | undefined;
  remoteVideo: MediaStreamTrack | undefined;
  streams: WeakSet<MediaStream>;
  queue: Promise<void>;
  restartTimer: unknown;
  closed: boolean;
}

/**
 * Mesh voice for rooms of up to 3: one RTCPeerConnection per pair of members, signalled over the
 * room's client topic.
 */
export class MeshVoice extends VoiceBase implements RoomVoiceClient {
  private readonly network: NetworkWatcher;
  private readonly media: MediaAccess;
  private readonly speaking: SpeakingMonitor;
  private readonly window: ReconnectWindow;

  /** True between a completed join and leave or failure. */
  private ready = false;
  private session = '';
  /** Bumped by every join, leave and failure so a slow join can tell it was overtaken. */
  private generation = 0;
  private everConnected = false;
  private iceServers: RTCIceServer[] = [];
  private micStream: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private micEnabled = false;
  private readonly peers = new Map<string, Peer>();
  /** Voice session ids of peers, learnt from their signalling. */
  private readonly sessions = new Map<string, string>();
  private presenceVoices = new Map<string, PresenceVoice>();
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: MeshVoiceDeps) {
    super(deps);
    this.network = deps.network ?? browserNetwork();
    this.media = deps.media ?? browserMedia();
    this.window = new ReconnectWindow(this.clock, () => this.onWindowExpired());
    this.speaking = new SpeakingMonitor({
      clock: this.clock,
      getContext: () => this.context,
      createMeter: deps.createLevelMeter,
      options: { ...DEFAULT_SPEAKING_OPTIONS, ...deps.speaking },
      log: this.log,
    });
    this.speaking.onChange((userId, speaking) => {
      if (speaking && userId !== this.me && !this.moderation.canPlay(userId)) return;
      this.speakingListeners.emit(userId, speaking);
    });
  }

  // Public interface ------------------------------------------------------------------------------

  async join(opts: { roomId: string; userId: string }): Promise<void> {
    // Runs before the first await, so it stays inside the "Join voice" tap.
    this.prepareAudio();
    if (this.active) {
      if (this.me === opts.userId) return;
      await this.leave();
    }
    const generation = ++this.generation;
    this.me = opts.userId;
    this.session = this.newSessionId();
    this.everConnected = false;
    this.micEnabled = !this.moderation.isMuted(this.me);
    this.setState('connecting');
    this.window.begin();

    const [ice, mic] = await Promise.allSettled([
      this.deps.getIceServers(),
      this.media.getUserMedia({ audio: MIC_CONSTRAINTS, video: false }),
    ]);
    if (generation !== this.generation) {
      if (mic.status === 'fulfilled') stopStream(mic.value);
      return;
    }
    if (ice.status === 'rejected' || mic.status === 'rejected') {
      if (mic.status === 'fulfilled') stopStream(mic.value);
      const error =
        ice.status === 'rejected'
          ? toVoiceError(ice.reason)
          : mediaError((mic as PromiseRejectedResult).reason, 'mic');
      this.fail(error);
      throw error;
    }
    const track = mic.value.getAudioTracks()[0];
    if (!track) {
      stopStream(mic.value);
      const error = new VoiceError('device_unavailable');
      this.fail(error);
      throw error;
    }

    this.iceServers = ice.value;
    this.micStream = mic.value;
    this.micTrack = track;
    this.micEnabled = this.micEnabled && !this.moderation.isMuted(this.me);
    track.enabled = this.micEnabled;
    if (this.micEnabled) this.speaking.watch(this.me, track);
    this.ready = true;

    this.unsubscribers.push(
      this.deps.signalling.onEvent((event) => this.onRtc(event)),
      this.deps.presence.subscribe((members) => this.onPresence(members)),
      this.network.onChange((online) => this.onNetworkChange(online)),
    );
    this.emitLocalMedia();
    this.send({ from: this.me, to: null, kind: 'hello', payload: { session: this.session } });
    this.onPresence(this.deps.presence.get());
    this.recompute();
  }

  async leave(): Promise<void> {
    this.generation++;
    this.teardown();
    this.state = 'idle';
    this.suspendAudio();
  }

  async setMicEnabled(on: boolean): Promise<void> {
    if (on && this.moderation.isMuted(this.me)) {
      const error = new VoiceError('host_muted');
      this.errorListeners.emit(error);
      throw error;
    }
    this.micEnabled = on;
    if (this.micTrack && this.me) {
      this.micTrack.enabled = on;
      if (on) this.speaking.watch(this.me, this.micTrack);
      else this.speaking.unwatch(this.me);
    }
    this.emitLocalMedia();
  }

  async setCameraEnabled(on: boolean): Promise<void> {
    if (!this.ready || !this.me) return;
    const me = this.me;
    if (!on) {
      const track = this.cameraTrack;
      if (!track) return;
      this.cameraTrack = null;
      for (const peer of this.peers.values()) this.enqueue(peer, () => this.stopVideo(peer));
      track.stop();
      this.trackListeners.emit(me, {});
      this.emitLocalMedia();
      return;
    }
    if (this.cameraTrack) return;
    if (this.moderation.isMuted(me)) {
      const error = new VoiceError('host_muted');
      this.errorListeners.emit(error);
      throw error;
    }
    const generation = this.generation;
    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia({ audio: false, video: CAMERA_CONSTRAINTS });
    } catch (err) {
      const error = mediaError(err, 'camera');
      this.errorListeners.emit(error);
      throw error;
    }
    const track = stream.getVideoTracks()[0];
    if (!track || generation !== this.generation || !this.ready || this.cameraTrack || this.moderation.isMuted(me)) {
      stopStream(stream);
      return;
    }
    this.cameraTrack = track;
    track.onended = () => {
      if (this.cameraTrack === track) void this.setCameraEnabled(false);
    };
    for (const peer of this.peers.values()) this.enqueue(peer, () => this.sendVideo(peer));
    this.trackListeners.emit(me, { video: track });
    this.emitLocalMedia();
  }

  /** Calls back at once with every member's current tracks, then on every change. */
  onTracks(cb: (userId: string, tracks: VoiceTracks) => void): () => void {
    const off = this.trackListeners.add(cb);
    if (this.me && this.cameraTrack) cb(this.me, { video: this.cameraTrack });
    for (const peer of this.peers.values()) {
      const tracks = this.playableTracks(peer);
      if (tracks.audio || tracks.video) cb(peer.id, tracks);
    }
    return off;
  }

  getLocalMedia(): LocalMedia {
    const hostMuted = this.moderation.isMuted(this.me);
    return {
      micEnabled: this.ready && this.micEnabled && !hostMuted,
      cameraEnabled: this.cameraTrack !== null,
      hostMuted,
    };
  }

  handleModeration(event: VoiceModeration): void {
    const effect = this.moderation.apply(event, this.me);
    switch (effect.kind) {
      case 'self_muted':
        this.applyHostMute(true);
        break;
      case 'self_unmuted':
        this.applyHostMute(false);
        break;
      case 'self_removed':
        if (this.state !== 'idle') void this.leave();
        break;
      case 'peer_muted':
      case 'peer_unmuted': {
        const peer = this.peers.get(effect.peer);
        if (peer) this.refreshPeerMedia(peer);
        break;
      }
      case 'peer_removed': {
        const peer = this.peers.get(effect.peer);
        if (peer) this.closePeer(peer);
        this.sessions.delete(effect.peer);
        this.recompute();
        break;
      }
      default:
        break;
    }
  }

  attachMedia(userId: string, kind: 'audio' | 'video', element: HTMLMediaElement): () => void {
    let track: MediaStreamTrack | undefined;
    const local = userId === this.me;
    if (local) {
      track = kind === 'video' ? (this.cameraTrack ?? undefined) : undefined;
    } else {
      const peer = this.peers.get(userId);
      if (peer) track = this.playableTracks(peer)[kind];
    }
    return track ? attachTrack(element, track, local) : () => {};
  }

  // Signalling ------------------------------------------------------------------------------------

  private onRtc(raw: RtcEvent): void {
    const parsed = RtcEvent.safeParse(raw);
    if (!parsed.success) {
      this.log('dropped invalid rtc event', parsed.error.issues);
      return;
    }
    const event = parsed.data;
    const me = this.me;
    if (!this.ready || !me || !isForMe(event, me)) return;
    if (this.moderation.isBlocked(event.from)) return;
    if (event.kind === 'hello') this.onHello(event, me);
    else if (event.kind === 'description') this.onDescription(event);
    else this.onCandidate(event);
  }

  private onHello(event: RtcEvent, me: string): void {
    const payload = HelloPayload.safeParse(event.payload);
    if (!payload.success) return;
    const session = payload.data.session;
    let peer = this.peers.get(event.from);
    const decision = decideHello({
      me,
      from: event.from,
      broadcast: event.to === null,
      hasConnection: peer !== undefined,
      knownSession: this.sessions.get(event.from) ?? null,
      session,
    });
    if (decision.reset && peer) {
      this.closePeer(peer, false);
      peer = undefined;
    }
    this.sessions.set(event.from, session);
    if (decision.reply) {
      this.send({ from: me, to: event.from, kind: 'hello', payload: { session: this.session } });
    }
    if (decision.initiate && !peer) this.createPeer(event.from, this.newId());
    if (decision.resend && peer) {
      const target = peer;
      this.enqueue(target, async () => {
        if (target.pc.signalingState === 'have-local-offer' && !target.makingOffer) this.sendDescription(target);
      });
    }
    this.recompute();
  }

  private onDescription(event: RtcEvent): void {
    const payload = DescriptionPayload.safeParse(event.payload);
    if (!payload.success) return;
    const { session, conn, description } = payload.data;
    let peer = this.peers.get(event.from);
    const route = routeDescription({ currentConn: peer?.conn ?? null, conn, type: description.type });
    if (route === 'drop') return;
    this.sessions.set(event.from, session);
    if (route === 'replace' || !peer) {
      if (peer) this.closePeer(peer, false);
      peer = this.createPeer(event.from, conn, false);
    }
    const target = peer;
    this.enqueue(target, () => this.applyDescription(target, description));
  }

  private async applyDescription(peer: Peer, description: DescriptionPayload['description']): Promise<void> {
    const pc = peer.pc;
    const decision = decideDescription({
      type: description.type,
      polite: peer.polite,
      makingOffer: peer.makingOffer,
      signalingState: pc.signalingState,
      settingRemoteAnswerPending: peer.settingRemoteAnswerPending,
    });
    peer.ignoreOffer = decision.action === 'ignore' && description.type === 'offer';
    if (decision.action === 'ignore') return;
    if (decision.rollback) await pc.setLocalDescription({ type: 'rollback' });
    peer.settingRemoteAnswerPending = description.type === 'answer';
    try {
      await pc.setRemoteDescription(description);
    } finally {
      peer.settingRemoteAnswerPending = false;
    }
    if (peer.closed || !decision.answer) return;
    await this.ensureLocalTracks(peer);
    await pc.setLocalDescription();
    if (!peer.closed) this.sendDescription(peer);
  }

  private onCandidate(event: RtcEvent): void {
    const payload = CandidatePayload.safeParse(event.payload);
    if (!payload.success) return;
    const peer = this.peers.get(event.from);
    if (!peer || peer.conn !== payload.data.conn) return;
    const candidate = payload.data.candidate;
    this.enqueue(peer, async () => {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!peer.ignoreOffer) this.log('could not add ICE candidate', err);
      }
    });
  }

  private onPresence(members: readonly VoicePresence[]): void {
    const me = this.me;
    if (!this.ready || !me) return;
    const current = new Map<string, PresenceVoice>();
    for (const m of members) current.set(m.user_id, m.voice);
    const ids = new Set([...this.presenceVoices.keys(), ...current.keys()]);
    for (const id of ids) {
      if (id === me) continue;
      const previous = this.presenceVoices.get(id) ?? 'absent';
      const now = current.get(id) ?? 'absent';
      const decision = decidePresence({
        me,
        peer: id,
        previous,
        current: now,
        hasConnection: this.peers.has(id),
        blocked: this.moderation.isBlocked(id),
      });
      if (isInVoice(previous) && !isInVoice(now)) this.sessions.delete(id);
      if (decision === 'close') {
        const peer = this.peers.get(id);
        if (peer) this.closePeer(peer, false);
      } else if (decision === 'initiate') {
        this.createPeer(id, this.newId());
      }
    }
    this.presenceVoices = current;
    this.recompute();
  }

  private send(event: RtcEvent): void {
    try {
      this.deps.signalling.send(event);
    } catch (err) {
      this.log('could not send rtc event', err);
    }
  }

  private sendDescription(peer: Peer): void {
    const d = peer.pc.localDescription;
    if (!this.me || !d || (d.type !== 'offer' && d.type !== 'answer')) return;
    this.send({
      from: this.me,
      to: peer.id,
      kind: 'description',
      payload: { session: this.session, conn: peer.conn, description: { type: d.type, sdp: d.sdp } },
    });
  }

  // Connections -----------------------------------------------------------------------------------

  /** Creates a connection. Unless `initiator` is false, this member starts it and sends the first offer. */
  private createPeer(id: string, conn: string, initiator = true): Peer {
    const me = this.me as string;
    const create =
      this.deps.createPeerConnection ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));
    const pc = create({ iceServers: this.iceServers });
    const peer: Peer = {
      id,
      conn,
      pc,
      polite: isPolite(me, id),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswerPending: false,
      everConnected: false,
      status: 'pending',
      audioSender: null,
      videoSender: null,
      remoteAudio: undefined,
      remoteVideo: undefined,
      streams: new WeakSet(),
      queue: Promise.resolve(),
      restartTimer: null,
      closed: false,
    };
    this.peers.set(id, peer);

    pc.onnegotiationneeded = () => {
      void this.makeOffer(peer);
    };
    pc.onicecandidate = (e) => {
      if (peer.closed || !e.candidate || !e.candidate.candidate) return;
      this.send({
        from: me,
        to: id,
        kind: 'candidate',
        payload: { session: this.session, conn, candidate: e.candidate.toJSON() },
      });
    };
    pc.ontrack = (e) => this.onRemoteTrack(peer, e);
    pc.onconnectionstatechange = () => this.onConnectionState(peer);
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') this.restartIce(peer);
    };
    // The member who starts the connection adds its tracks now, which fires negotiationneeded and
    // sends the first offer. The other side adds them once the offer is applied, so its tracks
    // share the offer's media sections instead of colliding with it.
    if (initiator) this.enqueue(peer, () => this.ensureLocalTracks(peer));
    return peer;
  }

  private async ensureLocalTracks(peer: Peer): Promise<void> {
    if (peer.closed || !this.micStream) return;
    if (!peer.audioSender && this.micTrack) {
      peer.audioSender = peer.pc.addTrack(this.micTrack, this.micStream);
      if (this.moderation.isMuted(this.me)) await peer.audioSender.replaceTrack(null);
    }
    if (!peer.videoSender && this.cameraTrack) {
      peer.videoSender = peer.pc.addTrack(this.cameraTrack, this.micStream);
    }
  }

  private async makeOffer(peer: Peer): Promise<void> {
    if (peer.closed) return;
    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      if (!peer.closed) this.sendDescription(peer);
    } catch (err) {
      this.log('could not make an offer', err);
    } finally {
      peer.makingOffer = false;
    }
  }

  private enqueue(peer: Peer, task: () => Promise<void>): void {
    peer.queue = peer.queue.then(async () => {
      if (peer.closed) return;
      try {
        await task();
      } catch (err) {
        this.log('signalling step failed', err);
      }
    });
  }

  private async sendVideo(peer: Peer): Promise<void> {
    const track = this.cameraTrack;
    if (!track || !this.micStream || peer.closed) return;
    const sender = peer.videoSender;
    if (!sender) {
      peer.videoSender = peer.pc.addTrack(track, this.micStream);
      return;
    }
    await sender.replaceTrack(track);
    const transceiver = peer.pc.getTransceivers().find((t) => t.sender === sender);
    if (transceiver?.direction === 'recvonly') transceiver.direction = 'sendrecv';
    else if (transceiver?.direction === 'inactive') transceiver.direction = 'sendonly';
  }

  private async stopVideo(peer: Peer): Promise<void> {
    if (peer.closed || !peer.videoSender?.track) return;
    // Renegotiates: the other side sees the video track removed.
    peer.pc.removeTrack(peer.videoSender);
  }

  private onRemoteTrack(peer: Peer, e: RTCTrackEvent): void {
    if (peer.closed) return;
    const track = e.track;
    if (track.kind === 'audio') peer.remoteAudio = track;
    else if (track.kind === 'video') peer.remoteVideo = track;
    else return;
    const forget = (gone: MediaStreamTrack) => {
      let changed = false;
      if (peer.remoteAudio === gone) {
        peer.remoteAudio = undefined;
        changed = true;
      }
      if (peer.remoteVideo === gone) {
        peer.remoteVideo = undefined;
        changed = true;
      }
      if (changed && !peer.closed) this.refreshPeerMedia(peer);
    };
    track.onended = () => forget(track);
    for (const stream of e.streams) {
      if (peer.streams.has(stream)) continue;
      peer.streams.add(stream);
      // Fires when the other side turns its camera off and renegotiates.
      stream.addEventListener('removetrack', (ev) => forget(ev.track));
    }
    this.refreshPeerMedia(peer);
  }

  private playableTracks(peer: Peer): VoiceTracks {
    if (!this.moderation.canPlay(peer.id)) return {};
    const tracks: VoiceTracks = {};
    if (peer.remoteAudio) tracks.audio = peer.remoteAudio;
    if (peer.remoteVideo) tracks.video = peer.remoteVideo;
    return tracks;
  }

  /** Applies moderation to a peer's tracks and reports them. A muted member is not played at all. */
  private refreshPeerMedia(peer: Peer): void {
    const playable = this.moderation.canPlay(peer.id);
    if (peer.remoteAudio) peer.remoteAudio.enabled = playable;
    if (peer.remoteVideo) peer.remoteVideo.enabled = playable;
    if (playable && peer.remoteAudio) this.speaking.watch(peer.id, peer.remoteAudio);
    else this.speaking.unwatch(peer.id);
    this.trackListeners.emit(peer.id, this.playableTracks(peer));
  }

  private onConnectionState(peer: Peer): void {
    if (peer.closed) return;
    const s = peer.pc.connectionState;
    if (s === 'closed') return;
    if (s === 'connected') {
      peer.status = 'connected';
      peer.everConnected = true;
      this.clearRestartTimer(peer);
    } else {
      peer.status = peer.everConnected ? 'dropped' : 'pending';
      if (s === 'failed') this.restartIce(peer);
      else if (s === 'disconnected') this.scheduleRestart(peer);
    }
    this.recompute();
  }

  private restartIce(peer: Peer): void {
    if (peer.closed) return;
    try {
      peer.pc.restartIce();
    } catch (err) {
      this.log('could not restart ICE', err);
    }
  }

  private scheduleRestart(peer: Peer): void {
    if (peer.restartTimer !== null) return;
    peer.restartTimer = this.clock.setTimeout(() => {
      peer.restartTimer = null;
      if (!peer.closed && peer.pc.connectionState === 'disconnected') this.restartIce(peer);
    }, DISCONNECTED_RESTART_MS);
  }

  private clearRestartTimer(peer: Peer): void {
    if (peer.restartTimer !== null) this.clock.clearTimeout(peer.restartTimer);
    peer.restartTimer = null;
  }

  private onNetworkChange(online: boolean): void {
    if (!this.ready) return;
    // A new network means new addresses: every connection gathers fresh candidates.
    if (online) for (const peer of this.peers.values()) this.restartIce(peer);
    this.recompute();
  }

  private closePeer(peer: Peer, recompute = true): void {
    if (peer.closed) return;
    peer.closed = true;
    this.clearRestartTimer(peer);
    if (this.peers.get(peer.id) === peer) this.peers.delete(peer.id);
    try {
      peer.pc.close();
    } catch {
      // Already closed.
    }
    this.speaking.unwatch(peer.id);
    const hadTracks = peer.remoteAudio !== undefined || peer.remoteVideo !== undefined;
    peer.remoteAudio = undefined;
    peer.remoteVideo = undefined;
    if (hadTracks) this.trackListeners.emit(peer.id, {});
    if (recompute) this.recompute();
  }

  // Moderation ------------------------------------------------------------------------------------

  private applyHostMute(muted: boolean): void {
    if (muted) {
      this.micEnabled = false;
      if (this.micTrack) this.micTrack.enabled = false;
      if (this.me) this.speaking.unwatch(this.me);
    }
    if (this.ready) {
      const track = muted ? null : this.micTrack;
      for (const peer of this.peers.values()) {
        const sender = peer.audioSender;
        if (sender) this.enqueue(peer, () => sender.replaceTrack(track));
      }
      if (muted && this.cameraTrack) void this.setCameraEnabled(false);
    }
    this.emitLocalMedia();
  }

  // State -----------------------------------------------------------------------------------------

  private recompute(): void {
    if (!this.ready || this.state === 'idle' || this.state === 'failed') return;
    let connected = 0;
    let dropped = 0;
    let pending = 0;
    for (const peer of this.peers.values()) {
      if (peer.status === 'connected') connected++;
      else if (peer.status === 'dropped') dropped++;
      else pending++;
    }
    const awaiting = new Set(this.sessions.keys());
    for (const [id, voice] of this.presenceVoices) if (isInVoice(voice)) awaiting.add(id);
    for (const id of awaiting) {
      if (id !== this.me && !this.peers.has(id) && !this.moderation.isBlocked(id)) pending++;
    }
    const next = meshVoiceState({
      online: this.network.isOnline(),
      everConnected: this.everConnected,
      connected,
      dropped,
      pending,
    });
    if (next === 'connected') {
      this.everConnected = true;
      this.window.end();
    } else {
      this.window.begin();
    }
    this.setState(next);
  }

  private onWindowExpired(): void {
    if (this.state === 'idle' || this.state === 'failed') return;
    this.generation++;
    this.fail(new VoiceError('disconnected'));
  }

  private fail(error: VoiceError): void {
    this.teardown();
    this.setState('failed');
    this.errorListeners.emit(error);
  }

  private teardown(): void {
    const me = this.me;
    this.ready = false;
    this.window.end();
    for (const off of this.unsubscribers.splice(0)) {
      try {
        off();
      } catch {
        // Nothing to undo.
      }
    }
    for (const peer of [...this.peers.values()]) this.closePeer(peer, false);
    this.sessions.clear();
    this.presenceVoices = new Map();
    this.speaking.stop();
    if (this.cameraTrack) {
      this.cameraTrack.stop();
      this.cameraTrack = null;
      if (me) this.trackListeners.emit(me, {});
    }
    stopStream(this.micStream);
    this.micStream = null;
    this.micTrack = null;
    this.micEnabled = false;
    this.emitLocalMedia();
  }

  private newSessionId(): string {
    return this.newId();
  }

  private newId(): string {
    return this.deps.newId?.() ?? crypto.randomUUID();
  }
}
