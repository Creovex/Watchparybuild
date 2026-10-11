import { describe, expect, it } from 'vitest';
import { ModerationState, moderationEffect } from '../src/moderation';

const ME = 'me';
const PEER = 'peer';

describe('moderation effects', () => {
  it('a mute of another member stops playing their tracks but keeps the connection', () => {
    expect(moderationEffect({ target: PEER, action: 'mute_voice' }, ME)).toEqual({ kind: 'peer_muted', peer: PEER });
  });

  it('a remove or ban of another member closes the connection to them', () => {
    expect(moderationEffect({ target: PEER, action: 'remove' }, ME)).toEqual({ kind: 'peer_removed', peer: PEER });
    expect(moderationEffect({ target: PEER, action: 'ban' }, ME)).toEqual({ kind: 'peer_removed', peer: PEER });
  });

  it('the muted member stops sending; a removed or banned member leaves voice', () => {
    expect(moderationEffect({ target: ME, action: 'mute_voice' }, ME)).toEqual({ kind: 'self_muted' });
    expect(moderationEffect({ target: ME, action: 'unmute_voice' }, ME)).toEqual({ kind: 'self_unmuted' });
    expect(moderationEffect({ target: ME, action: 'remove' }, ME)).toEqual({ kind: 'self_removed' });
    expect(moderationEffect({ target: ME, action: 'ban' }, ME)).toEqual({ kind: 'self_removed' });
  });

  it('allow back matters only for other members', () => {
    expect(moderationEffect({ target: PEER, action: 'allow_back' }, ME)).toEqual({
      kind: 'peer_allowed_back',
      peer: PEER,
    });
    expect(moderationEffect({ target: ME, action: 'allow_back' }, ME)).toEqual({ kind: 'none' });
  });

  it('before voice knows who this member is, every target counts as another member', () => {
    expect(moderationEffect({ target: ME, action: 'mute_voice' }, null)).toEqual({ kind: 'peer_muted', peer: ME });
  });
});

describe('moderation state', () => {
  it('stops playing a muted member and plays them again after unmute', () => {
    const s = new ModerationState();
    expect(s.canPlay(PEER)).toBe(true);
    s.apply({ target: PEER, action: 'mute_voice' }, ME);
    expect(s.canPlay(PEER)).toBe(false);
    expect(s.isBlocked(PEER)).toBe(false);
    expect(s.apply({ target: PEER, action: 'unmute_voice' }, ME)).toEqual({ kind: 'peer_unmuted', peer: PEER });
    expect(s.canPlay(PEER)).toBe(true);
  });

  it('blocks a removed member until allowed back', () => {
    const s = new ModerationState();
    s.apply({ target: PEER, action: 'ban' }, ME);
    expect(s.isBlocked(PEER)).toBe(true);
    expect(s.canPlay(PEER)).toBe(false);
    expect(s.apply({ target: PEER, action: 'allow_back' }, ME).kind).toBe('peer_allowed_back');
    expect(s.isBlocked(PEER)).toBe(false);
  });

  it('repeated events change nothing', () => {
    const s = new ModerationState();
    s.apply({ target: PEER, action: 'mute_voice' }, ME);
    expect(s.apply({ target: PEER, action: 'mute_voice' }, ME)).toEqual({ kind: 'none' });
    expect(s.apply({ target: 'other', action: 'unmute_voice' }, ME)).toEqual({ kind: 'none' });
    expect(s.apply({ target: 'other', action: 'allow_back' }, ME)).toEqual({ kind: 'none' });
  });

  it('remembers a mute reported before voice knew the local user id', () => {
    const s = new ModerationState();
    s.apply({ target: ME, action: 'mute_voice' }, null);
    expect(s.isMuted(ME)).toBe(true);
    expect(s.isMuted(null)).toBe(false);
    expect(s.apply({ target: ME, action: 'unmute_voice' }, ME)).toEqual({ kind: 'self_unmuted' });
    expect(s.isMuted(ME)).toBe(false);
  });
});
