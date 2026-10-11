// Timed comments: chat messages pinned to a playback position, shown again when anyone reaches it.

/** A timed comment shows in the reaction band for 4 seconds, long enough to read a short message. */
export const TIMED_VISIBLE_MS = 4000;
/** Larger jumps are seeks, not playback passing a comment. */
const MAX_PASS_JUMP_SEC = 2;

export interface Pinned {
  id: string;
  position_sec: number | null;
}

/** Comments whose position was passed between two successive polls of normal playback. */
export function passedComments<T extends Pinned>(previous: number, current: number, comments: readonly T[]): T[] {
  const delta = current - previous;
  if (delta <= 0 || delta > MAX_PASS_JUMP_SEC) return [];
  return comments.filter((c) => c.position_sec !== null && c.position_sec > previous && c.position_sec <= current);
}
