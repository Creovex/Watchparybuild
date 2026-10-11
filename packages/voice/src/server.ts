import type {
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  Room,
  RoomOptions,
  VideoCaptureOptions,
} from 'livekit-client';
import { VoiceBase, type VoiceBaseDeps } from './base';
import { CAMERA_FPS, CAMERA_HEIGHT, CAMERA_WIDTH, MIC_CONSTRAINTS } from './media';
import {
  FINAL_TOKEN_CODES,
  ReconnectWindow,
  retryDelayMs,
  serverDisconnectAction,
} from './reconnect';
import { mediaError, toVoiceError } from './runtime';
import {
  VoiceError,
  type LocalMedia,
  type RoomVoiceClient,
  type VoiceModeration,
  type VoiceTracks,
} from './types';

export type LiveKitModule = typeof import('livekit-client');

export interface ServerVoiceDeps extends VoiceBaseDeps {
  /** A LiveKit token for this room; the web app calls the `livekit-token` Edge Function. */
  getToken(): Promise<{ url: string; token: string }>;
  /** Loads `livekit-client`. Loaded on first join so mesh rooms never download it. */
  loadLiveKit?: () => Promise<LiveKitModule>;
}

/**
 * Same capture as mesh voice (DEFAULT, gap G32): the prompt sets no camera size for server voice.
 * Simulcast is on whenever the camera is.
 */
const CAMERA_CAPTURE: VideoCaptureOptions = {
  resolution: { width: CAMERA_WIDTH, height: CAMERA_HEIGHT, frameRate: CAMERA_FPS },
  facingMode: 'user',
};

/** Which speakers started and stopped speaking between two LiveKit active speaker updates. Pure. */
export function diffSpeakers(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): Array<[string, boolean]> {
  const changes: Array<[string, boolean]> = [];
  for (const id of previous) if (!next.has(id)) changes.push([id, false]);
  for (const id of next) if (!previous.has(id)) changes.push([id, true]);
  return changes;
}

type Attempt = { ok: true } | { ok: false; error: VoiceError; final: boolean };

/**
 * Server voice for rooms of up to 10: audio and optional camera routed through LiveKit. Moderation is
 * enforced on LiveKit's server by the `moderate` Edge Function; this client also stops playing a
 * muted or removed member at once.
 */
export class ServerVoice extends VoiceBase implements RoomVoiceClient {
  private lk: LiveKitModule | null = null;
  private room: Room | null = null;
  private generation = 0;
  private everConnected = false;
  private micEnabled = false;
  private cameraEnabled = false;
  private attempt = 0;
  private retryTimer: unknown = null;
  private speakingIds = new Set<string>();
  /** Members whose tracks were last reported as non empty. */
  private readonly reported = new Set<string>();
  private readonly window: ReconnectWindow;

  constructor(private readonly deps: ServerVoiceDeps) {
    super(deps);
    this.window = new ReconnectWindow(this.clock, () => this.onWindowExpired());
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
    this.everConnected = false;
    this.attempt = 0;
    this.micEnabled = !this.moderation.isMuted(this.me);
    this.cameraEnabled = false;
    this.setState('connecting');
    this.window.begin();
    try {
      this.lk ??= await (this.deps.loadLiveKit ?? (() => import('livekit-client')))();
    } catch (err) {
      if (generation !== this.generation) return;
      const error = toVoiceError(err);
      this.fail(error);
      throw error;
    }
    if (generation !== this.generation) return;
    const result = await this.attemptConnect(generation);
    if (!result.ok && result.final) throw result.error;
  }

  async leave(): Promise<void> {
    this.generation++;
    const room = this.room;
    this.room = null;
    this.teardown();
    this.state = 'idle';
    this.suspendAudio();
    if (room) await room.disconnect(true).catch(() => {});
  }

  async setMicEnabled(on: boolean): Promise<void> {
    if (on && this.moderation.isMuted(this.me)) {
      const error = new VoiceError('host_muted');
      this.errorListeners.emit(error);
      throw error;
    }
    const previous = this.micEnabled;
    this.micEnabled = on;
    const room = this.room;
    if (room && this.active) {
      try {
        await room.localParticipant.setMicrophoneEnabled(on, MIC_CONSTRAINTS);
      } catch (err) {
        this.micEnabled = on ? false : previous;
        const error = mediaError(err, 'mic');
        this.errorListeners.emit(error);
        this.emitLocalMedia();
        throw error;
      }
    }
    this.emitLocalMedia();
  }

  async setCameraEnabled(on: boolean): Promise<void> {
    const room = this.room;
    if (!room || !this.active || !this.me) return;
    if (on && this.moderation.isMuted(this.me)) {
      const error = new VoiceError('host_muted');
      this.errorListeners.emit(error);
      throw error;
    }
    if (on === this.cameraEnabled) return;
    this.cameraEnabled = on;
    try {
      await room.localParticipant.setCameraEnabled(on, CAMERA_CAPTURE, { simulcast: true });
    } catch (err) {
      this.cameraEnabled = false;
      const error = mediaError(err, 'camera');
      this.errorListeners.emit(error);
      this.emitLocalTracks();
      this.emitLocalMedia();
      throw error;
    }
    this.emitLocalTracks();
    this.emitLocalMedia();
  }

  /** Calls back at once with every member's current tracks, then on every change. */
  onTracks(cb: (userId: string, tracks: VoiceTracks) => void): () => void {
    const off = this.trackListeners.add(cb);
    const room = this.room;
    if (room && this.me) {
      const local = this.localTracks();
      if (local.video) cb(this.me, local);
      for (const participant of room.remoteParticipants.values()) {
        const tracks = this.remoteTracks(participant);
        if (tracks.audio || tracks.video) cb(participant.identity, tracks);
      }
    }
    return off;
  }

  getLocalMedia(): LocalMedia {
    const hostMuted = this.moderation.isMuted(this.me);
    return {
      micEnabled: this.active && this.micEnabled && !hostMuted,
      cameraEnabled: this.active && this.cameraEnabled,
      hostMuted,
    };
  }

  handleModeration(event: VoiceModeration): void {
    const effect = this.moderation.apply(event, this.me);
    const room = this.room;
    switch (effect.kind) {
      case 'self_muted': {
        // LiveKit also revokes publishing for this member on the server.
        const hadCamera = this.cameraEnabled;
        this.micEnabled = false;
        this.cameraEnabled = false;
        if (room) {
          room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
          room.localParticipant.setCameraEnabled(false).catch(() => {});
        }
        if (this.me) this.setSpeaking(this.me, false);
        if (hadCamera) this.emitLocalTracks();
        this.emitLocalMedia();
        break;
      }
      case 'self_unmuted':
        this.emitLocalMedia();
        break;
      case 'self_removed':
        if (this.state !== 'idle') void this.leave();
        break;
      case 'peer_muted':
      case 'peer_removed':
        this.setSubscribed(effect.peer, false);
        this.setSpeaking(effect.peer, false);
        this.report(effect.peer, {});
        break;
      case 'peer_unmuted':
      case 'peer_allowed_back':
        if (this.moderation.canPlay(effect.peer)) this.setSubscribed(effect.peer, true);
        break;
      default:
        break;
    }
  }

  attachMedia(userId: string, kind: 'audio' | 'video', element: HTMLMediaElement): () => void {
    const room = this.room;
    const lk = this.lk;
    if (!room || !lk) return () => {};
    if (userId === this.me) {
      if (kind !== 'video') return () => {};
      const track = room.localParticipant.getTrackPublication(lk.Track.Source.Camera)?.track;
      if (!track) return () => {};
      element.muted = true;
      track.attach(element);
      return () => {
        track.detach(element);
      };
    }
    if (!this.moderation.canPlay(userId)) return () => {};
    const source = kind === 'audio' ? lk.Track.Source.Microphone : lk.Track.Source.Camera;
    const track = room.remoteParticipants.get(userId)?.getTrackPublication(source)?.track;
    if (!track) return () => {};
    // Attaching tells adaptive stream the video is on screen and how big it is.
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }

  // Connecting ------------------------------------------------------------------------------------

  private roomOptions(): Partial<RoomOptions> {
    return {
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { ...MIC_CONSTRAINTS },
      videoCaptureDefaults: CAMERA_CAPTURE,
      publishDefaults: { simulcast: true },
      disconnectOnPageLeave: true,
    };
  }

  /** One connection attempt with a fresh token. Retries on its own until the window ends. */
  private async attemptConnect(generation: number): Promise<Attempt> {
    const result = await this.connect(generation);
    if (generation !== this.generation) return result;
    if (result.ok) return result;
    if (result.final) {
      this.generation++;
      this.fail(result.error);
    } else {
      this.log('voice connection attempt failed', result.error);
      this.scheduleRetry(generation);
    }
    return result;
  }

  private async connect(generation: number): Promise<Attempt> {
    const lk = this.lk;
    if (!lk) return { ok: false, error: new VoiceError('internal'), final: true };
    let credentials: { url: string; token: string };
    try {
      // A new token every time, so a reconnect after the 10 minute token expiry still works and a
      // member removed meanwhile is refused.
      credentials = await this.deps.getToken();
    } catch (err) {
      const error = toVoiceError(err);
      return { ok: false, error, final: FINAL_TOKEN_CODES.includes(error.code) };
    }
    if (generation !== this.generation) return { ok: true };

    const room = new lk.Room(this.roomOptions());
    this.room = room;
    this.bind(lk, room, generation);
    try {
      await room.connect(credentials.url, credentials.token);
    } catch (err) {
      if (this.room === room) this.room = null;
      await room.disconnect(true).catch(() => {});
      return { ok: false, error: toVoiceError(err), final: false };
    }
    if (generation !== this.generation || this.room !== room) {
      await room.disconnect(true).catch(() => {});
      return { ok: true };
    }

    const hostMuted = this.moderation.isMuted(this.me);
    try {
      if (this.micEnabled && !hostMuted) {
        await room.localParticipant.setMicrophoneEnabled(true, MIC_CONSTRAINTS);
      }
    } catch (err) {
      return { ok: false, error: mediaError(err, 'mic'), final: true };
    }
    try {
      if (this.cameraEnabled && !hostMuted) {
        await room.localParticipant.setCameraEnabled(true, CAMERA_CAPTURE, { simulcast: true });
      }
    } catch (err) {
      this.cameraEnabled = false;
      this.errorListeners.emit(mediaError(err, 'camera'));
    }
    if (generation !== this.generation || this.room !== room) return { ok: true };
    this.onConnected();
    return { ok: true };
  }

  private bind(lk: LiveKitModule, room: Room, generation: number): void {
    const current = () => generation === this.generation && this.room === room;
    const E = lk.RoomEvent;
    room
      .on(E.Reconnecting, () => {
        if (!current()) return;
        this.setState('reconnecting');
        this.window.begin();
      })
      .on(E.Reconnected, () => {
        if (current()) this.onConnected();
      })
      .on(E.Disconnected, (reason) => {
        if (current()) this.onDisconnected(generation, reason);
      })
      .on(E.TrackSubscribed, (_track, _publication, participant) => {
        if (current()) this.report(participant.identity, this.remoteTracks(participant));
      })
      .on(E.TrackUnsubscribed, (_track, _publication, participant) => {
        if (current()) this.report(participant.identity, this.remoteTracks(participant));
      })
      .on(E.TrackMuted, (_publication, participant) => {
        if (current()) this.onParticipantTracks(participant);
      })
      .on(E.TrackUnmuted, (_publication, participant) => {
        if (current()) this.onParticipantTracks(participant);
      })
      .on(E.ParticipantDisconnected, (participant) => {
        if (!current()) return;
        this.setSpeaking(participant.identity, false);
        this.report(participant.identity, {});
      })
      .on(E.ActiveSpeakersChanged, (speakers: Participant[]) => {
        if (current()) this.onActiveSpeakers(speakers);
      })
      .on(E.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
        if (!current() || publication.source !== lk.Track.Source.Camera) return;
        this.cameraEnabled = false;
        this.emitLocalTracks();
        this.emitLocalMedia();
      })
      .on(E.ParticipantPermissionsChanged, (_previous, participant) => {
        if (!current() || participant !== room.localParticipant) return;
        if (participant.permissions?.canPublish === false) {
          // The server stopped this member publishing; it has already unpublished their tracks.
          this.micEnabled = false;
          this.cameraEnabled = false;
          this.emitLocalTracks();
          this.emitLocalMedia();
        }
      })
      .on(E.MediaDevicesError, (error: Error, kind?: MediaDeviceKind) => {
        if (current()) this.errorListeners.emit(mediaError(error, kind === 'videoinput' ? 'camera' : 'mic'));
      });
  }

  private onConnected(): void {
    this.everConnected = true;
    this.attempt = 0;
    this.window.end();
    this.setState('connected');
    this.emitLocalMedia();
  }

  private onDisconnected(generation: number, reason: number | undefined): void {
    this.room = null;
    this.clearRemote();
    const action = serverDisconnectAction(reason, false);
    if (action.kind === 'ignore') return;
    if (action.kind === 'fail') {
      this.generation++;
      this.fail(new VoiceError(action.code));
      return;
    }
    this.setState(this.everConnected ? 'reconnecting' : 'connecting');
    this.window.begin();
    this.scheduleRetry(generation);
  }

  private scheduleRetry(generation: number): void {
    if (this.retryTimer !== null) return;
    this.window.begin();
    const delay = retryDelayMs(this.attempt++);
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (generation === this.generation) void this.attemptConnect(generation);
    }, delay);
  }

  private onWindowExpired(): void {
    if (!this.active) return;
    this.generation++;
    const room = this.room;
    this.room = null;
    room?.disconnect(true).catch(() => {});
    this.fail(new VoiceError('disconnected'));
  }

  private fail(error: VoiceError): void {
    const room = this.room;
    this.room = null;
    room?.disconnect(true).catch(() => {});
    this.teardown();
    this.setState('failed');
    this.errorListeners.emit(error);
  }

  private teardown(): void {
    this.window.end();
    if (this.retryTimer !== null) this.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearRemote();
    const hadCamera = this.cameraEnabled;
    this.micEnabled = false;
    this.cameraEnabled = false;
    if (this.me) {
      this.setSpeaking(this.me, false);
      if (hadCamera) this.trackListeners.emit(this.me, {});
    }
    this.emitLocalMedia();
  }

  // Tracks and speaking ---------------------------------------------------------------------------

  private remoteTracks(participant: RemoteParticipant): VoiceTracks {
    const lk = this.lk;
    if (!lk || !this.moderation.canPlay(participant.identity)) return {};
    const tracks: VoiceTracks = {};
    const audio = participant.getTrackPublication(lk.Track.Source.Microphone);
    const video = participant.getTrackPublication(lk.Track.Source.Camera);
    if (audio?.track) tracks.audio = audio.track.mediaStreamTrack;
    if (video?.track && !video.isMuted) tracks.video = video.track.mediaStreamTrack;
    return tracks;
  }

  private localTracks(): VoiceTracks {
    const lk = this.lk;
    const room = this.room;
    if (!lk || !room || !this.cameraEnabled) return {};
    const track = room.localParticipant.getTrackPublication(lk.Track.Source.Camera)?.track;
    return track ? { video: track.mediaStreamTrack } : {};
  }

  private onParticipantTracks(participant: Participant): void {
    if (participant.identity === this.me) {
      this.emitLocalTracks();
      return;
    }
    const remote = this.room?.remoteParticipants.get(participant.identity);
    if (remote) this.report(remote.identity, this.remoteTracks(remote));
  }

  private emitLocalTracks(): void {
    if (this.me) this.trackListeners.emit(this.me, this.localTracks());
  }

  private report(userId: string, tracks: VoiceTracks): void {
    const empty = !tracks.audio && !tracks.video;
    if (empty && !this.reported.has(userId)) return;
    if (empty) this.reported.delete(userId);
    else this.reported.add(userId);
    this.trackListeners.emit(userId, tracks);
  }

  private clearRemote(): void {
    for (const id of [...this.speakingIds]) if (id !== this.me) this.setSpeaking(id, false);
    for (const id of [...this.reported]) this.report(id, {});
  }

  private onActiveSpeakers(speakers: Participant[]): void {
    const next = new Set<string>();
    for (const s of speakers) {
      if (s.identity === this.me || this.moderation.canPlay(s.identity)) next.add(s.identity);
    }
    for (const [id, speaking] of diffSpeakers(this.speakingIds, next)) {
      this.speakingListeners.emit(id, speaking);
    }
    this.speakingIds = next;
  }

  private setSpeaking(userId: string, speaking: boolean): void {
    if (speaking === this.speakingIds.has(userId)) return;
    if (speaking) this.speakingIds.add(userId);
    else this.speakingIds.delete(userId);
    this.speakingListeners.emit(userId, speaking);
  }

  private setSubscribed(userId: string, subscribed: boolean): void {
    const participant = this.room?.remoteParticipants.get(userId);
    if (!participant) return;
    for (const publication of participant.trackPublications.values()) {
      publication.setSubscribed(subscribed);
    }
  }
}
