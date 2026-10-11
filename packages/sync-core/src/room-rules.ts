import type { SyncMode } from './schemas';

// Rules about members that the database also enforces. The client uses them to decide what to show
// and which member runs heartbeats and wait for everyone; the database stays the authority.

/** A member is present when seen within the last 60 seconds. Clients refresh every 20 seconds. */
export const PRESENT_WINDOW_MS = 60_000;
export const TOUCH_INTERVAL_MS = 20_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** Buffering shorter than this is the normal stall every stream has. */
export const BUFFER_PAUSE_AFTER_MS = 1_500;
/** Resume once nobody has been buffering for this long. */
export const BUFFER_RESUME_AFTER_MS = 1_000;
export const COUNTDOWN_MS = 4_000;

export interface MemberLike {
  user_id: string;
  state: string;
  sync_mode: SyncMode;
  first_joined_at: string;
  last_seen_at: string;
  buffering_since: string | null;
}

export function isPresent(member: Pick<MemberLike, 'state' | 'last_seen_at'>, serverNow: number): boolean {
  return member.state === 'joined' && serverNow - Date.parse(member.last_seen_at) <= PRESENT_WINDOW_MS;
}

/** The present member on auto sync who joined first, or null when none is on auto sync. */
export function electedMember<T extends MemberLike>(members: readonly T[], serverNow: number): T | null {
  let best: T | null = null;
  for (const m of members) {
    if (!isPresent(m, serverNow) || m.sync_mode !== 'auto') continue;
    if (!best || Date.parse(m.first_joined_at) < Date.parse(best.first_joined_at)) best = m;
  }
  return best;
}

export interface WaitInput {
  waitForEveryone: boolean;
  status: 'playing' | 'paused' | 'ended';
  pausedReason: 'user' | 'buffer' | null;
  members: readonly MemberLike[];
  serverNow: number;
}

export type WaitDecision =
  | { action: 'pause'; buffering: string[] }
  | { action: 'resume' }
  | { action: 'none' };

/**
 * Wait for everyone, run by the elected member every second. Pauses when a present member has been
 * buffering for more than 1.5 seconds; resumes a buffer pause once nobody has buffered for 1 second.
 * A pause a controller made is never resumed here.
 */
export class WaitForEveryone {
  private lastBufferingSeenAt = Number.NEGATIVE_INFINITY;

  decide(input: WaitInput): WaitDecision {
    if (!input.waitForEveryone) return { action: 'none' };
    const present = input.members.filter((m) => isPresent(m, input.serverNow));
    const bufferingNow = present.filter((m) => m.buffering_since !== null);
    if (bufferingNow.length > 0) this.lastBufferingSeenAt = input.serverNow;

    if (input.status === 'playing') {
      const stalled = bufferingNow.filter(
        (m) => input.serverNow - Date.parse(m.buffering_since as string) > BUFFER_PAUSE_AFTER_MS,
      );
      return stalled.length > 0 ? { action: 'pause', buffering: stalled.map((m) => m.user_id) } : { action: 'none' };
    }
    if (input.status === 'paused' && input.pausedReason === 'buffer') {
      return bufferingNow.length === 0 && input.serverNow - this.lastBufferingSeenAt >= BUFFER_RESUME_AFTER_MS
        ? { action: 'resume' }
        : { action: 'none' };
    }
    return { action: 'none' };
  }
}

/** Phones are devices whose browser reports a coarse pointer; tablets count as phones. */
export function deviceKind(matchMedia: ((q: string) => { matches: boolean }) | undefined): 'phone' | 'desktop' {
  return matchMedia?.('(pointer: coarse)').matches ? 'phone' : 'desktop';
}
