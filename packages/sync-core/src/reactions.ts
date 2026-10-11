import { REACTION_EMOJI, type ReactionEmoji } from './schemas';

/** Each reaction floats for 2 seconds: long enough to notice without hiding the scene. */
export const REACTION_VISIBLE_MS = 2000;
/** At most 3 per second per sender: excited tapping is fine, filling the screen is not. */
export const REACTIONS_PER_SECOND = 3;

export const REACTIONS: readonly ReactionEmoji[] = REACTION_EMOJI;

export const REACTION_LABEL: Record<ReactionEmoji, string> = {
  '❤️': 'Love',
  '😂': 'Laugh',
  '😮': 'Wow',
  '😢': 'Sad',
  '😡': 'Angry',
  '👏': 'Applause',
  '🔥': 'Fire',
  '🍿': 'Popcorn',
};

/** Drops reactions beyond the per sender limit within any one second window. */
export class ReactionLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(private readonly limit = REACTIONS_PER_SECOND) {}

  allow(sender: string, now: number): boolean {
    const recent = (this.seen.get(sender) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= this.limit) {
      this.seen.set(sender, recent);
      return false;
    }
    recent.push(now);
    this.seen.set(sender, recent);
    return true;
  }
}
