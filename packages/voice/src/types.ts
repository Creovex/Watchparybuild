import type { ErrorCode, ModerationEvent, PresencePayload, RtcEvent } from '@watchparty/sync-core';

export type VoiceState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface VoiceTracks {
  audio?: MediaStreamTrack;
  video?: MediaStreamTrack;
}

/** The voice interface from the build prompt. The room's voice mode picks the implementation. */
export interface VoiceClient {
  join(opts: { roomId: string; userId: string }): Promise<void>;
  leave(): Promise<void>;
  setMicEnabled(on: boolean): Promise<void>;
  setCameraEnabled(on: boolean): Promise<void>;
  /** Includes the local user. */
  onSpeaking(cb: (userId: string, speaking: boolean) => void): () => void;
  onTracks(cb: (userId: string, tracks: VoiceTracks) => void): () => void;
  onState(cb: (s: VoiceState) => void): () => void;
}

/** What the local member is sending. `hostMuted` is true while the host has muted this member. */
export interface LocalMedia {
  micEnabled: boolean;
  cameraEnabled: boolean;
  hostMuted: boolean;
}

/** The part of a moderation event voice acts on. `ModerationEvent` from the server topic fits it. */
export type VoiceModeration = Pick<ModerationEvent, 'target' | 'action'>;

/**
 * Everything the room page and the extension panel use. Both implementations provide all of it, so
 * room code never needs to know which one runs.
 */
export interface RoomVoiceClient extends VoiceClient {
  /**
   * Creates or resumes the audio context. iOS allows this only inside a tap, so the "Join voice"
   * handler must call this (or `join`, which calls it first) synchronously, before any await.
   */
  prepareAudio(): void;
  /** `idle` before the first join and after leave. */
  getState(): VoiceState | 'idle';
  getLocalMedia(): LocalMedia;
  onLocalMedia(cb: (media: LocalMedia) => void): () => void;
  onError(cb: (error: VoiceError) => void): () => void;
  /**
   * Applies a moderation change. Call it for every `moderation` server event, and with
   * `mute_voice` or `unmute_voice` whenever a `members` row's `voice_muted` changes or is first
   * loaded. Safe to call before join and more than once.
   */
  handleModeration(event: VoiceModeration): void;
  /**
   * Plays a member's audio or video in an element and returns a function that detaches it. Use this
   * rather than wiring `onTracks` tracks by hand: server voice only sends video that is attached to
   * a visible element. The local user's microphone is never attached, so nobody hears themself.
   */
  attachMedia(userId: string, kind: 'audio' | 'video', element: HTMLMediaElement): () => void;
}

// Errors ------------------------------------------------------------------------------------------

/** Codes voice adds to the shared error codes. Each needs a sentence in the web app's error map. */
export const VOICE_ONLY_ERROR_CODES = [
  'mic_denied',
  'camera_denied',
  'device_unavailable',
  'host_muted',
  'disconnected',
  'replaced',
] as const;
export type VoiceOnlyErrorCode = (typeof VOICE_ONLY_ERROR_CODES)[number];
export type VoiceErrorCode = ErrorCode | VoiceOnlyErrorCode;

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(code: VoiceErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'VoiceError';
    this.code = code;
  }
}

// Injected dependencies ---------------------------------------------------------------------------

/** Mesh signalling. The room wires it to the `rtc` event on the client topic. */
export interface RtcTransport {
  send(event: RtcEvent): void;
  onEvent(cb: (event: RtcEvent) => void): () => void;
}

export type VoicePresence = Pick<PresencePayload, 'user_id' | 'voice'>;

/** Presence on the client topic, the local member included. */
export interface PresenceFeed {
  get(): readonly VoicePresence[];
  subscribe(cb: (members: readonly VoicePresence[]) => void): () => void;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Reports network changes: going online or offline, or switching between Wi-Fi and mobile data. */
export interface NetworkWatcher {
  isOnline(): boolean;
  onChange(cb: (online: boolean) => void): () => void;
}

export interface MediaAccess {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export type Logger = (message: string, detail?: unknown) => void;
