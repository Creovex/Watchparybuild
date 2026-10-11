import { describe, expect, it } from 'vitest';
import { deviceKind, electedMember, isPresent, WaitForEveryone, type MemberLike } from '../src/room-rules';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function member(id: string, partial: Partial<MemberLike> = {}): MemberLike {
  return {
    user_id: id,
    state: 'joined',
    sync_mode: 'auto',
    first_joined_at: iso(100_000),
    last_seen_at: iso(1000),
    buffering_since: null,
    ...partial,
  };
}

describe('presence', () => {
  it('counts joined members seen within 60 seconds', () => {
    expect(isPresent(member('a', { last_seen_at: iso(59_000) }), NOW)).toBe(true);
    expect(isPresent(member('a', { last_seen_at: iso(61_000) }), NOW)).toBe(false);
    expect(isPresent(member('a', { state: 'left' }), NOW)).toBe(false);
  });
});

describe('elected member', () => {
  it('is the present auto sync member who joined first', () => {
    const members = [
      member('late', { first_joined_at: iso(10_000) }),
      member('cue', { first_joined_at: iso(900_000), sync_mode: 'cue' }),
      member('absent', { first_joined_at: iso(800_000), last_seen_at: iso(120_000) }),
      member('first', { first_joined_at: iso(500_000) }),
    ];
    expect(electedMember(members, NOW)?.user_id).toBe('first');
  });

  it('is nobody when no present member is on auto sync', () => {
    expect(electedMember([member('a', { sync_mode: 'cue' })], NOW)).toBeNull();
  });
});

describe('wait for everyone', () => {
  const input = (members: MemberLike[], over: Partial<Parameters<WaitForEveryone['decide']>[0]> = {}) => ({
    waitForEveryone: true,
    status: 'playing' as const,
    pausedReason: null,
    members,
    serverNow: NOW,
    ...over,
  });

  it('is inactive when the room has it off', () => {
    const w = new WaitForEveryone();
    expect(w.decide(input([member('a', { buffering_since: iso(5000) })], { waitForEveryone: false }))).toEqual({
      action: 'none',
    });
  });

  it('pauses when a present member has buffered for more than 1.5 seconds', () => {
    const w = new WaitForEveryone();
    expect(w.decide(input([member('a', { buffering_since: iso(1000) })])).action).toBe('none');
    expect(w.decide(input([member('a', { buffering_since: iso(1600) }), member('b')]))).toEqual({
      action: 'pause',
      buffering: ['a'],
    });
  });

  it('ignores buffering members who are not present', () => {
    const w = new WaitForEveryone();
    const absent = member('a', { buffering_since: iso(5000), last_seen_at: iso(70_000) });
    expect(w.decide(input([absent])).action).toBe('none');
  });

  it('resumes a buffer pause once nobody has buffered for 1 second', () => {
    const w = new WaitForEveryone();
    const paused = { status: 'paused' as const, pausedReason: 'buffer' as const };
    expect(w.decide(input([member('a', { buffering_since: iso(3000) })], paused)).action).toBe('none');
    expect(w.decide(input([member('a')], { ...paused, serverNow: NOW + 500 })).action).toBe('none');
    expect(w.decide(input([member('a')], { ...paused, serverNow: NOW + 1000 })).action).toBe('resume');
  });

  it('never resumes a pause a controller made', () => {
    const w = new WaitForEveryone();
    expect(w.decide(input([member('a')], { status: 'paused', pausedReason: 'user' })).action).toBe('none');
  });

  it('does nothing once playback has ended', () => {
    const w = new WaitForEveryone();
    expect(w.decide(input([member('a', { buffering_since: iso(5000) })], { status: 'ended' })).action).toBe('none');
  });
});

describe('device kind', () => {
  it('treats a coarse pointer as a phone', () => {
    expect(deviceKind(() => ({ matches: true }))).toBe('phone');
    expect(deviceKind(() => ({ matches: false }))).toBe('desktop');
    expect(deviceKind(undefined)).toBe('desktop');
  });
});
