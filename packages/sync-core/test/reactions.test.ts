import { describe, expect, it } from 'vitest';
import { REACTION_LABEL, ReactionLimiter, REACTIONS } from '../src/reactions';

describe('reactions', () => {
  it('has eight reactions, each with a label', () => {
    expect(REACTIONS).toHaveLength(8);
    for (const emoji of REACTIONS) expect(REACTION_LABEL[emoji]).toBeTruthy();
  });

  it('allows 3 per second per sender and drops the rest', () => {
    const limiter = new ReactionLimiter();
    expect([0, 100, 200, 300].map((t) => limiter.allow('a', t))).toEqual([true, true, true, false]);
    expect(limiter.allow('b', 300)).toBe(true);
    expect(limiter.allow('a', 1001)).toBe(true);
  });
});
