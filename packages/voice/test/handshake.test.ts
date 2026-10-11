import { describe, expect, it } from 'vitest';
import {
  CandidatePayload,
  DescriptionPayload,
  HelloPayload,
  decideDescription,
  decideHello,
  decidePresence,
  isForMe,
  isPolite,
  routeDescription,
  sessionChanged,
  shouldInitiate,
} from '../src/handshake';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('who offers', () => {
  it('only the lexically smaller user id starts the connection', () => {
    expect(shouldInitiate(A, B)).toBe(true);
    expect(shouldInitiate(B, A)).toBe(false);
  });

  it('compares the ids as text, not as numbers', () => {
    expect(shouldInitiate('9', '10')).toBe(false);
    expect(shouldInitiate('a', 'b')).toBe(true);
  });

  it('the smaller id is the polite peer', () => {
    expect(isPolite(A, B)).toBe(true);
    expect(isPolite(B, A)).toBe(false);
  });
});

describe('event filtering', () => {
  it('accepts broadcast events and events addressed to me', () => {
    expect(isForMe({ from: B, to: null }, A)).toBe(true);
    expect(isForMe({ from: B, to: A }, A)).toBe(true);
  });

  it('ignores events addressed to someone else', () => {
    expect(isForMe({ from: B, to: C }, A)).toBe(false);
  });

  it('ignores my own events, broadcast or directed', () => {
    expect(isForMe({ from: A, to: null }, A)).toBe(false);
    expect(isForMe({ from: A, to: A }, A)).toBe(false);
  });
});

describe('hello rules', () => {
  const base = { me: A, from: B, broadcast: true, hasConnection: false, knownSession: null, session: 's1' };

  it('replies with a directed hello to a broadcast hello from someone with no connection', () => {
    expect(decideHello(base).reply).toBe(true);
  });

  it('never replies to a directed hello, so two members cannot loop', () => {
    expect(decideHello({ ...base, broadcast: false }).reply).toBe(false);
    expect(decideHello({ ...base, me: B, from: A, broadcast: false }).reply).toBe(false);
  });

  it('does not reply when a connection already exists', () => {
    expect(decideHello({ ...base, hasConnection: true, knownSession: 's1' }).reply).toBe(false);
  });

  it('the smaller id starts the connection on any hello; the larger waits', () => {
    expect(decideHello(base).initiate).toBe(true);
    expect(decideHello({ ...base, broadcast: false }).initiate).toBe(true);
    expect(decideHello({ ...base, me: B, from: A }).initiate).toBe(false);
  });

  it('a new session from a connected peer means they rejoined: reset, reply and start again', () => {
    const d = decideHello({ ...base, hasConnection: true, knownSession: 'old', session: 'new' });
    expect(d).toEqual({ reset: true, reply: true, initiate: true, resend: false });
  });

  it('the same session from a connected peer changes nothing', () => {
    const d = decideHello({ ...base, hasConnection: true, knownSession: 's1' });
    expect(d).toEqual({ reset: false, reply: false, initiate: false, resend: false });
  });

  it('resends the offer when the connection was started from presence before hearing from the peer', () => {
    const d = decideHello({ ...base, broadcast: false, hasConnection: true, knownSession: null });
    expect(d).toEqual({ reset: false, reply: false, initiate: false, resend: true });
  });
});

describe('presence rules', () => {
  const base = {
    me: A,
    peer: B,
    previous: 'absent' as const,
    current: 'live' as const,
    hasConnection: false,
    blocked: false,
  };

  it('the smaller id starts a connection on seeing the peer with voice not off', () => {
    expect(decidePresence(base)).toBe('initiate');
    expect(decidePresence({ ...base, current: 'muted' })).toBe('initiate');
  });

  it('the larger id waits', () => {
    expect(decidePresence({ ...base, me: B, peer: A })).toBe('none');
  });

  it('voice off starts nothing', () => {
    expect(decidePresence({ ...base, current: 'off' })).toBe('none');
  });

  it('never connects to a removed or banned member, or twice', () => {
    expect(decidePresence({ ...base, blocked: true })).toBe('none');
    expect(decidePresence({ ...base, hasConnection: true })).toBe('none');
  });

  it('closes the connection when the peer leaves voice or presence', () => {
    expect(decidePresence({ ...base, previous: 'live', current: 'off', hasConnection: true })).toBe('close');
    expect(decidePresence({ ...base, previous: 'muted', current: 'absent', hasConnection: true })).toBe('close');
  });

  it('a stale off that never followed an on does not close a new connection', () => {
    expect(decidePresence({ ...base, previous: 'off', current: 'off', hasConnection: true })).toBe('none');
    expect(decidePresence({ ...base, previous: 'absent', current: 'off', hasConnection: true })).toBe('none');
  });

  it('ignores my own presence', () => {
    expect(decidePresence({ ...base, peer: A })).toBe('none');
  });
});

describe('perfect negotiation', () => {
  const offer = {
    type: 'offer' as const,
    polite: false,
    makingOffer: false,
    signalingState: 'stable' as RTCSignalingState,
    settingRemoteAnswerPending: false,
  };

  it('accepts and answers an offer when stable', () => {
    expect(decideDescription(offer)).toEqual({ action: 'accept', rollback: false, answer: true });
    expect(decideDescription({ ...offer, polite: true })).toEqual({ action: 'accept', rollback: false, answer: true });
  });

  it('the impolite peer ignores a colliding offer', () => {
    expect(decideDescription({ ...offer, makingOffer: true })).toEqual({ action: 'ignore' });
    expect(decideDescription({ ...offer, signalingState: 'have-local-offer' })).toEqual({ action: 'ignore' });
  });

  it('the polite peer rolls back its own offer and accepts', () => {
    expect(decideDescription({ ...offer, polite: true, signalingState: 'have-local-offer' })).toEqual({
      action: 'accept',
      rollback: true,
      answer: true,
    });
  });

  it('the polite peer accepts while its own offer is still being made, without an explicit rollback', () => {
    expect(decideDescription({ ...offer, polite: true, makingOffer: true })).toEqual({
      action: 'accept',
      rollback: false,
      answer: true,
    });
  });

  it('an offer is not a collision while a remote answer is being applied', () => {
    expect(
      decideDescription({ ...offer, signalingState: 'have-local-offer', settingRemoteAnswerPending: true }),
    ).toEqual({ action: 'accept', rollback: false, answer: true });
  });

  it('applies an answer only while an offer of ours is outstanding', () => {
    const answer = { ...offer, type: 'answer' as const };
    expect(decideDescription({ ...answer, signalingState: 'have-local-offer' })).toEqual({
      action: 'accept',
      rollback: false,
      answer: false,
    });
    expect(decideDescription(answer)).toEqual({ action: 'ignore' });
  });

  it('ignores other description types', () => {
    expect(decideDescription({ ...offer, type: 'pranswer' })).toEqual({ action: 'ignore' });
  });
});

describe('connection ids and sessions', () => {
  it('routes a description by connection id', () => {
    expect(routeDescription({ currentConn: 'c1', conn: 'c1', type: 'answer' })).toBe('existing');
    expect(routeDescription({ currentConn: 'c1', conn: 'c2', type: 'offer' })).toBe('replace');
    expect(routeDescription({ currentConn: null, conn: 'c2', type: 'offer' })).toBe('replace');
    expect(routeDescription({ currentConn: 'c1', conn: 'c2', type: 'answer' })).toBe('drop');
    expect(routeDescription({ currentConn: null, conn: 'c2', type: 'answer' })).toBe('drop');
  });

  it('a session changes only between two known ids that differ', () => {
    expect(sessionChanged(null, 's')).toBe(false);
    expect(sessionChanged('s', 's')).toBe(false);
    expect(sessionChanged('s', 't')).toBe(true);
  });

  it('validates payloads', () => {
    expect(HelloPayload.safeParse({ session: 's' }).success).toBe(true);
    expect(HelloPayload.safeParse({}).success).toBe(false);
    expect(
      DescriptionPayload.safeParse({ session: 's', conn: 'c', description: { type: 'offer', sdp: 'v=0' } }).success,
    ).toBe(true);
    expect(
      DescriptionPayload.safeParse({ session: 's', conn: 'c', description: { type: 'rollback', sdp: '' } }).success,
    ).toBe(false);
    expect(
      CandidatePayload.safeParse({ session: 's', conn: 'c', candidate: { candidate: 'candidate:1', sdpMid: '0' } })
        .success,
    ).toBe(true);
    expect(CandidatePayload.safeParse({ session: 's', candidate: { candidate: 'x' } }).success).toBe(false);
  });
});
