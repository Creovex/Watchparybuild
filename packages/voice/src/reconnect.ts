import type { Clock, VoiceState } from './types';

/** Voice reconnects on its own for 30 seconds, which covers a lift or a tunnel, then gives up. */
export const RECONNECT_WINDOW_MS = 30_000;

/**
 * Runs while voice is connecting or reconnecting. If it stays open for the whole window, `onExpire`
 * fires once and the client moves to `failed` ("Voice disconnected, tap to rejoin").
 */
export class ReconnectWindow {
  private startedAt: number | null = null;
  private timer: unknown = null;

  constructor(
    private readonly clock: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'>,
    private readonly onExpire: () => void,
    private readonly windowMs: number = RECONNECT_WINDOW_MS,
  ) {}

  get running(): boolean {
    return this.startedAt !== null;
  }

  /** Milliseconds left before giving up, or null when the window is not running. */
  remainingMs(): number | null {
    if (this.startedAt === null) return null;
    return Math.max(0, this.windowMs - (this.clock.now() - this.startedAt));
  }

  /** Voice is unhealthy. Starts the window unless it already runs; never extends it. */
  begin(): void {
    if (this.startedAt !== null) return;
    this.startedAt = this.clock.now();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.startedAt = null;
      this.onExpire();
    }, this.windowMs);
  }

  /** Voice is healthy again, or was left on purpose. */
  end(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.startedAt = null;
  }
}

export interface MeshHealth {
  online: boolean;
  /** True once this voice session has been `connected` at least once. */
  everConnected: boolean;
  /** Connections that are up. */
  connected: number;
  /** Connections that were up and went down. */
  dropped: number;
  /** Members in voice that this member has not reached yet. */
  pending: number;
}

/**
 * Mesh voice state from its connections (DEFAULT, see docs/decisions.md):
 * offline means reconnecting (or still connecting if never connected); one live connection means
 * connected, because a single member dropping is their problem, not this member's; with no live
 * connection, a dropped one means reconnecting; members not reached yet keep a fresh join connecting;
 * alone in voice is connected.
 */
export function meshVoiceState(h: MeshHealth): Exclude<VoiceState, 'failed'> {
  if (!h.online) return h.everConnected ? 'reconnecting' : 'connecting';
  if (h.connected > 0) return 'connected';
  if (h.dropped > 0) return 'reconnecting';
  if (h.pending > 0 && !h.everConnected) return 'connecting';
  return 'connected';
}

/** LiveKit disconnect reasons, as numbered in LiveKit's protocol. */
export const LIVEKIT_DISCONNECT = {
  UNKNOWN_REASON: 0,
  CLIENT_INITIATED: 1,
  DUPLICATE_IDENTITY: 2,
  SERVER_SHUTDOWN: 3,
  PARTICIPANT_REMOVED: 4,
  ROOM_DELETED: 5,
  STATE_MISMATCH: 6,
  JOIN_FAILURE: 7,
  MIGRATION: 8,
  SIGNAL_CLOSE: 9,
  ROOM_CLOSED: 10,
  USER_UNAVAILABLE: 11,
  USER_REJECTED: 12,
  SIP_TRUNK_FAILURE: 13,
  CONNECTION_TIMEOUT: 14,
  MEDIA_FAILURE: 15,
} as const;

export type ServerDisconnectAction =
  | { kind: 'ignore' }
  | { kind: 'retry' }
  | { kind: 'fail'; code: 'disconnected' | 'replaced' };

/**
 * What server voice does when LiveKit reports a disconnect. A removal, a closed room or the same
 * identity joining elsewhere is final; anything else is retried with a new token until the 30 second
 * window ends.
 */
export function serverDisconnectAction(reason: number | undefined, leaving: boolean): ServerDisconnectAction {
  if (leaving || reason === LIVEKIT_DISCONNECT.CLIENT_INITIATED) return { kind: 'ignore' };
  switch (reason) {
    case LIVEKIT_DISCONNECT.DUPLICATE_IDENTITY:
      return { kind: 'fail', code: 'replaced' };
    case LIVEKIT_DISCONNECT.PARTICIPANT_REMOVED:
    case LIVEKIT_DISCONNECT.ROOM_DELETED:
    case LIVEKIT_DISCONNECT.ROOM_CLOSED:
      return { kind: 'fail', code: 'disconnected' };
    default:
      return { kind: 'retry' };
  }
}

/** Delay before reconnect attempt `attempt` (0 based): 1, 2, 4, then every 5 seconds. */
export function retryDelayMs(attempt: number): number {
  return Math.min(5_000, 1_000 * 2 ** attempt);
}

/** Codes from the token function that make a retry pointless. */
export const FINAL_TOKEN_CODES: readonly string[] = [
  'unauthorized',
  'not_member',
  'wrong_voice_mode',
  'voice_muted',
  'not_found',
];
