import type { LocalMedia, VoiceState } from './types';

/** Microphone constraints for both implementations. */
export const MIC_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const satisfies MediaTrackConstraints;

/**
 * Camera is off by default. When on: 320 by 240 at 15 frames per second, so three people on mobile
 * data stay near 1 Mbps upload.
 */
export const CAMERA_WIDTH = 320;
export const CAMERA_HEIGHT = 240;
export const CAMERA_FPS = 15;

export const CAMERA_CONSTRAINTS = {
  width: { ideal: CAMERA_WIDTH },
  height: { ideal: CAMERA_HEIGHT },
  frameRate: { ideal: CAMERA_FPS, max: CAMERA_FPS },
  facingMode: 'user',
} as const satisfies MediaTrackConstraints;

/** The `voice` field of the member's own presence payload. */
export function presenceVoice(state: VoiceState | 'idle', media: LocalMedia): 'off' | 'muted' | 'live' {
  if (state === 'idle' || state === 'failed') return 'off';
  return media.micEnabled && !media.hostMuted ? 'live' : 'muted';
}
