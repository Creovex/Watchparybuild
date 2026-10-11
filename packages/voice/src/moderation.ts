import type { VoiceModeration } from './types';

export type ModerationEffect =
  | { kind: 'none' }
  /** The host muted this member: stop sending audio and camera; no unmute until the host unmutes. */
  | { kind: 'self_muted' }
  /** The host unmuted this member: they may unmute themselves again. The mic stays off until they do. */
  | { kind: 'self_unmuted' }
  /** This member was removed or banned: leave voice. */
  | { kind: 'self_removed' }
  /** Another member was muted: stop playing their tracks, keep the connection. */
  | { kind: 'peer_muted'; peer: string }
  | { kind: 'peer_unmuted'; peer: string }
  /** Another member was removed or banned: stop playing their tracks and close the connection. */
  | { kind: 'peer_removed'; peer: string }
  /** The host allowed a removed member back: they may connect again after rejoining. */
  | { kind: 'peer_allowed_back'; peer: string };

/** What a moderation event means for the member `me` (null before voice knows who that is). Pure. */
export function moderationEffect(event: VoiceModeration, me: string | null): ModerationEffect {
  const self = me !== null && event.target === me;
  switch (event.action) {
    case 'mute_voice':
      return self ? { kind: 'self_muted' } : { kind: 'peer_muted', peer: event.target };
    case 'unmute_voice':
      return self ? { kind: 'self_unmuted' } : { kind: 'peer_unmuted', peer: event.target };
    case 'remove':
    case 'ban':
      return self ? { kind: 'self_removed' } : { kind: 'peer_removed', peer: event.target };
    case 'allow_back':
      return self ? { kind: 'none' } : { kind: 'peer_allowed_back', peer: event.target };
    default:
      return { kind: 'none' };
  }
}

/**
 * Remembers who is muted or removed, by user id, so late tracks and signalling from them are not
 * played or answered. It keeps its state across joins because the room may report mutes before
 * voice is joined.
 */
export class ModerationState {
  private readonly muted = new Set<string>();
  private readonly removed = new Set<string>();

  /** Records the event and returns what to do now. An event that changes nothing returns `none`. */
  apply(event: VoiceModeration, me: string | null): ModerationEffect {
    const effect = moderationEffect(event, me);
    switch (event.action) {
      case 'mute_voice':
        if (this.muted.has(event.target)) return { kind: 'none' };
        this.muted.add(event.target);
        return effect;
      case 'unmute_voice':
        if (!this.muted.delete(event.target)) return { kind: 'none' };
        return effect;
      case 'remove':
      case 'ban':
        this.removed.add(event.target);
        return effect;
      case 'allow_back':
        if (!this.removed.delete(event.target)) return { kind: 'none' };
        return effect;
      default:
        return { kind: 'none' };
    }
  }

  /** True while the host has this member muted. */
  isMuted(userId: string | null): boolean {
    return userId !== null && this.muted.has(userId);
  }

  /** True when this member's audio and video may play here. */
  canPlay(userId: string): boolean {
    return !this.muted.has(userId) && !this.removed.has(userId);
  }

  /** True when signalling from this member is ignored and no connection to them is made. */
  isBlocked(userId: string): boolean {
    return this.removed.has(userId);
  }
}
