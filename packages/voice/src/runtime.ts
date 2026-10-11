import { ERROR_CODES } from '@watchparty/sync-core';
import {
  VOICE_ONLY_ERROR_CODES,
  VoiceError,
  type Clock,
  type Logger,
  type MediaAccess,
  type NetworkWatcher,
  type VoiceErrorCode,
} from './types';

/** A set of callbacks. One callback throwing never stops the others. */
export class Listeners<A extends unknown[]> {
  private readonly callbacks = new Set<(...args: A) => void>();

  constructor(private readonly log: Logger = () => {}) {}

  add(cb: (...args: A) => void): () => void {
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }

  emit(...args: A): void {
    for (const cb of [...this.callbacks]) {
      try {
        cb(...args);
      } catch (err) {
        this.log('voice listener threw', err);
      }
    }
  }

  clear(): void {
    this.callbacks.clear();
  }
}

export const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

interface NetworkInformationLike {
  addEventListener(type: 'change', cb: () => void): void;
  removeEventListener(type: 'change', cb: () => void): void;
}

/** Listens to `online`, `offline` and, where the browser has it, the network information `change` event. */
export function browserNetwork(): NetworkWatcher {
  const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  return {
    isOnline,
    onChange(cb) {
      if (typeof window === 'undefined') return () => {};
      const fire = () => cb(isOnline());
      window.addEventListener('online', fire);
      window.addEventListener('offline', fire);
      const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
      connection?.addEventListener('change', fire);
      return () => {
        window.removeEventListener('online', fire);
        window.removeEventListener('offline', fire);
        connection?.removeEventListener('change', fire);
      };
    },
  };
}

export function browserMedia(): MediaAccess {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  };
}

type AudioContextConstructor = new () => AudioContext;

export function browserAudioContext(): AudioContext {
  const w = globalThis as typeof globalThis & { webkitAudioContext?: AudioContextConstructor };
  const Ctor: AudioContextConstructor | undefined = globalThis.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new VoiceError('device_unavailable');
  return new Ctor();
}

export const defaultLogger: Logger = (message, detail) => {
  console.warn(`[voice] ${message}`, detail ?? '');
};

const KNOWN_CODES = new Set<string>([...ERROR_CODES, ...VOICE_ONLY_ERROR_CODES]);

/** Turns anything thrown by an injected dependency into a VoiceError; unknown faults become `internal`. */
export function toVoiceError(err: unknown, fallback: VoiceErrorCode = 'internal'): VoiceError {
  if (err instanceof VoiceError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && KNOWN_CODES.has(code)) {
    return new VoiceError(code as VoiceErrorCode, { cause: err });
  }
  return new VoiceError(fallback, { cause: err });
}

/** Plays one track in an element; returns a function that detaches it again. */
export function attachTrack(element: HTMLMediaElement, track: MediaStreamTrack, local: boolean): () => void {
  const stream = new MediaStream([track]);
  element.srcObject = stream;
  element.autoplay = true;
  if (local) element.muted = true;
  if ('playsInline' in element) (element as HTMLVideoElement).playsInline = true;
  void element.play().catch(() => {});
  return () => {
    if (element.srcObject === stream) element.srcObject = null;
  };
}

export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/** Maps a getUserMedia failure to a voice error code. */
export function mediaError(err: unknown, device: 'mic' | 'camera'): VoiceError {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new VoiceError(device === 'mic' ? 'mic_denied' : 'camera_denied', { cause: err });
  }
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
    return new VoiceError('device_unavailable', { cause: err });
  }
  return toVoiceError(err);
}
