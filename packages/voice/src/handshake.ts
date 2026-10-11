import { z } from 'zod';
import type { RtcEvent } from '@watchparty/sync-core';

/**
 * Mesh signalling rules. For each pair of members, only the member with the lexically smaller user id
 * creates the connection and sends the first offer; the other waits for it. Renegotiation follows
 * MDN's "perfect negotiation" pattern with the smaller id as the polite peer.
 */

/** True when `me` starts the connection to `peer`. */
export function shouldInitiate(me: string, peer: string): boolean {
  return me < peer;
}

/** True when `me` is the polite peer towards `peer`: it rolls back its own offer on a collision. */
export function isPolite(me: string, peer: string): boolean {
  return me < peer;
}

/** Drops events from this member itself and events addressed to someone else. */
export function isForMe(event: Pick<RtcEvent, 'from' | 'to'>, me: string): boolean {
  if (event.from === me) return false;
  return event.to === null || event.to === me;
}

/** True when a peer's voice session id changed, which means they left voice and joined again. */
export function sessionChanged(known: string | null, incoming: string | null): boolean {
  return known !== null && incoming !== null && known !== incoming;
}

export interface HelloInput {
  me: string;
  from: string;
  /** True for the `to: null` hello a member sends on joining; false for a directed reply. */
  broadcast: boolean;
  hasConnection: boolean;
  /** The peer's session id as known from earlier signalling, or null. */
  knownSession: string | null;
  session: string;
}

export interface HelloDecision {
  /** Close the existing connection first: the peer left voice and joined again. */
  reset: boolean;
  /** Reply with a directed hello. Only broadcast hellos get a reply, so two members never loop. */
  reply: boolean;
  /** Create the connection and send the first offer. */
  initiate: boolean;
  /**
   * Send the outstanding offer again. This member started the connection from presence before
   * hearing from the peer, so the peer may have dropped that offer while it was still joining.
   */
  resend: boolean;
}

export function decideHello(i: HelloInput): HelloDecision {
  const reset = i.hasConnection && sessionChanged(i.knownSession, i.session);
  const connected = i.hasConnection && !reset;
  return {
    reset,
    reply: i.broadcast && !connected,
    initiate: !connected && shouldInitiate(i.me, i.from),
    resend: connected && i.knownSession === null,
  };
}

/**
 * Where a description from a peer goes. Every connection has an id chosen by the member who started
 * it; an offer with a new id replaces the old connection, and anything else for an unknown id is stale.
 */
export function routeDescription(i: {
  currentConn: string | null;
  conn: string;
  type: 'offer' | 'answer';
}): 'existing' | 'replace' | 'drop' {
  if (i.currentConn === i.conn) return 'existing';
  return i.type === 'offer' ? 'replace' : 'drop';
}

export type PresenceVoice = 'off' | 'muted' | 'live' | 'absent';

/** True when presence shows the member in voice, muted or not. */
export function isInVoice(voice: PresenceVoice | undefined): boolean {
  return voice === 'muted' || voice === 'live';
}

export interface PresenceInput {
  me: string;
  peer: string;
  previous: PresenceVoice;
  current: PresenceVoice;
  hasConnection: boolean;
  blocked: boolean;
}

/**
 * What to do when a member's presence changes. The smaller id starts a connection on seeing the
 * other in voice. A connection closes only when the peer goes from in voice to out of voice (or out
 * of presence), so a stale "off" that arrives just after their hello cannot close a new connection.
 */
export function decidePresence(i: PresenceInput): 'initiate' | 'close' | 'none' {
  if (i.peer === i.me) return 'none';
  const wasOn = isInVoice(i.previous);
  const isOn = isInVoice(i.current);
  if (!isOn) return wasOn && i.hasConnection ? 'close' : 'none';
  if (i.blocked || i.hasConnection) return 'none';
  return shouldInitiate(i.me, i.peer) ? 'initiate' : 'none';
}

export interface DescriptionInput {
  type: RTCSdpType;
  polite: boolean;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
  settingRemoteAnswerPending: boolean;
}

export type DescriptionDecision =
  | { action: 'ignore' }
  | { action: 'accept'; rollback: boolean; answer: boolean };

/**
 * Perfect negotiation, as documented on MDN. An offer collides when this side is making an offer or
 * is not stable. The impolite peer ignores a colliding offer; the polite peer rolls back its own offer
 * and accepts. An answer is applied only while an offer of ours is outstanding.
 */
export function decideDescription(i: DescriptionInput): DescriptionDecision {
  if (i.type === 'offer') {
    const readyForOffer =
      !i.makingOffer && (i.signalingState === 'stable' || i.settingRemoteAnswerPending);
    const collision = !readyForOffer;
    if (collision && !i.polite) return { action: 'ignore' };
    return {
      action: 'accept',
      rollback: collision && i.signalingState === 'have-local-offer',
      answer: true,
    };
  }
  if (i.type === 'answer') {
    if (i.signalingState !== 'have-local-offer') return { action: 'ignore' };
    return { action: 'accept', rollback: false, answer: false };
  }
  return { action: 'ignore' };
}

// Payloads of the `rtc` event. Every payload carries the sender's voice session id, which changes
// each time they join voice.

const Session = z.string().min(1).max(64);

export const HelloPayload = z.object({ session: Session });
export type HelloPayload = z.infer<typeof HelloPayload>;

/** Identifies one RTCPeerConnection pair; chosen by the member who starts it. */
const Conn = z.string().min(1).max(64);

export const DescriptionPayload = z.object({
  session: Session,
  conn: Conn,
  description: z.object({
    type: z.enum(['offer', 'answer']),
    sdp: z.string().max(200_000),
  }),
});
export type DescriptionPayload = z.infer<typeof DescriptionPayload>;

export const CandidatePayload = z.object({
  session: Session,
  conn: Conn,
  candidate: z.object({
    candidate: z.string().max(2_000),
    sdpMid: z.string().max(64).nullable().optional(),
    sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
});
export type CandidatePayload = z.infer<typeof CandidatePayload>;
