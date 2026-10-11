// The contract every player adapter implements: the YouTube embedded player in the web app, the
// video element inside a Netflix, Prime Video or Disney+ tab in the extension, and the stub adapter
// used by end to end tests.

export interface AdapterCapabilities {
  /** True when the player can play at rate x 0.95 and rate x 1.05 for gentle drift correction. */
  fineRate: boolean;
  /** True when the player's volume can be set by script (needed for ducking). */
  volume: boolean;
  /** True when the player can be seeked by script. */
  seek: boolean;
  /** Starting estimate of the time from a seek call until playback resumes. */
  seekLatencySec: number;
}

export type UserActionKind = 'play' | 'pause' | 'seek';

export interface UserAction {
  kind: UserActionKind;
  position: number;
}

export interface PlayerAdapter {
  capabilities: AdapterCapabilities;
  load(contentRef: string): Promise<void>;
  play(): Promise<'ok' | 'blocked'>;
  pause(): Promise<void>;
  seek(sec: number): Promise<void>;
  setRate(rate: number): void;
  /** 0 to 1; no effect when capabilities.volume is false. */
  setVolume(level: number): void;
  getVolume(): number;
  getPosition(): number;
  getDuration(): number | null;
  isPaused(): boolean;
  isBuffering(): boolean;
  isEnded(): boolean;
  onUserAction(cb: (a: UserAction) => void): () => void;
  onBuffering(cb: (buffering: boolean) => void): () => void;
  onEnded(cb: () => void): () => void;
  destroy(): void;
}
