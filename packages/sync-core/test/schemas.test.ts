import { describe, expect, it } from 'vitest';
import {
  ClientEvents,
  ERROR_CODES,
  ExtensionReply,
  HandoverMessage,
  isPaidSource,
  MemberRow,
  MessageRow,
  PageToExtension,
  parseEvent,
  PresencePayload,
  RoomRow,
  ServerEvents,
  SILENT_CODES,
  toResult,
  JoinResult,
  PlaybackStateRow,
} from '../src/schemas';

const A = '6f1a5b3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const B = '7a2b6c4d-2d3e-4f60-9b0c-1d2e3f4a5b6c';
const ROOM = '8b3c7d5e-3e4f-4071-8c1d-2e3f4a5b6c7d';
const TS = '2026-10-11T01:33:44.523723+00:00';

const playback = {
  room_id: ROOM,
  seq: 3,
  status: 'playing',
  position_sec: 12.5,
  rate: 1,
  server_ts: TS,
  paused_reason: null,
  updated_by: A,
};

const room = {
  id: ROOM,
  slug: 'aB3_xY9-kL',
  host_id: A,
  title: 'Friday film club',
  visibility: 'private',
  source: 'youtube',
  content_ref: 'dQw4w9WgXcQ',
  control_mode: 'host',
  wait_for_everyone: true,
  room_cap: 3,
  voice_mode: 'mesh',
  locked: false,
  status: 'open',
  channel_epoch: 1,
  created_at: TS,
  last_active_at: TS,
};

const memberRow = {
  room_id: ROOM,
  user_id: B,
  role: 'guest',
  state: 'joined',
  voice_muted: false,
  sync_mode: 'auto',
  buffering_since: null,
  first_joined_at: TS,
  last_seen_at: TS,
  left_at: null,
};

const message = {
  id: A,
  room_id: ROOM,
  user_id: null,
  kind: 'timed',
  body: 'This scene!',
  system_code: null,
  position_sec: 61,
  created_at: TS,
  deleted_at: null,
};

describe('server topic events', () => {
  it('accept database rows', () => {
    expect(ServerEvents.state.safeParse(playback).success).toBe(true);
    expect(ServerEvents.room.safeParse(room).success).toBe(true);
    expect(ServerEvents.members.safeParse(memberRow).success).toBe(true);
    expect(ServerEvents.chat.safeParse(message).success).toBe(true);
    expect(ServerEvents.moderation.safeParse({ target: B, action: 'ban', new_epoch: 2 }).success).toBe(true);
  });

  it('refuse rows with wrong values', () => {
    expect(PlaybackStateRow.safeParse({ ...playback, status: 'stopped' }).success).toBe(false);
    expect(PlaybackStateRow.safeParse({ ...playback, server_ts: 'yesterday' }).success).toBe(false);
    expect(RoomRow.safeParse({ ...room, room_cap: 5 }).success).toBe(false);
    expect(MemberRow.safeParse({ ...memberRow, state: 'kicked' }).success).toBe(false);
    expect(MessageRow.safeParse({ ...message, kind: 'html' }).success).toBe(false);
    expect(ServerEvents.moderation.safeParse({ target: B, action: 'shout', new_epoch: 2 }).success).toBe(false);
  });
});

describe('client topic events', () => {
  it('accept valid heartbeat, reaction and rtc events', () => {
    expect(ClientEvents.heartbeat.safeParse({ seq: 4, observed_position: 10, observed_server_ms: 1 }).success).toBe(true);
    expect(ClientEvents.reaction.safeParse({ emoji: '🍿', position_sec: 3 }).success).toBe(true);
    expect(ClientEvents.rtc.safeParse({ from: A, to: null, kind: 'hello', payload: null }).success).toBe(true);
    expect(ClientEvents.rtc.safeParse({ from: A, to: B, kind: 'candidate', payload: { c: 1 } }).success).toBe(true);
  });

  it('refuse invalid events', () => {
    expect(ClientEvents.heartbeat.safeParse({ seq: -1, observed_position: 0, observed_server_ms: 0 }).success).toBe(false);
    expect(ClientEvents.reaction.safeParse({ emoji: '💩', position_sec: 3 }).success).toBe(false);
    expect(ClientEvents.rtc.safeParse({ from: A, to: null, kind: 'description', payload: {} }).success).toBe(false);
    expect(ClientEvents.rtc.safeParse({ from: 'me', to: null, kind: 'hello', payload: null }).success).toBe(false);
  });

  it('validate presence', () => {
    const p = { user_id: A, display_name: 'Sam', device: 'phone', sync_mode: 'cue', voice: 'live', engine: 'page' };
    expect(PresencePayload.safeParse(p).success).toBe(true);
    expect(PresencePayload.safeParse({ ...p, device: 'tv' }).success).toBe(false);
  });

  it('drop and log invalid events through parseEvent', () => {
    const logged: string[] = [];
    expect(parseEvent(ClientEvents.reaction, { emoji: 'x' }, (m) => logged.push(m))).toBeNull();
    expect(logged).toEqual(['dropped invalid event']);
    expect(parseEvent(ClientEvents.reaction, { emoji: '🔥', position_sec: 1 })).toEqual({ emoji: '🔥', position_sec: 1 });
    expect(parseEvent(ClientEvents.reaction, null)).toBeNull();
  });
});

describe('results', () => {
  it('normalise success and failure envelopes', () => {
    expect(toResult({ ok: true, data: { a: 1 } })).toEqual({ ok: true, data: { a: 1 } });
    expect(toResult({ ok: false, code: 'room_full', data: { room_cap: 3 } })).toEqual({
      ok: false,
      code: 'room_full',
      data: { room_cap: 3 },
    });
  });

  it('turn unknown codes and shapes into internal', () => {
    expect(toResult({ ok: false, code: 'boom' })).toEqual({ ok: false, code: 'internal', data: undefined });
    expect(toResult('nope')).toEqual({ ok: false, code: 'internal' });
  });

  it('validate data with a schema', () => {
    const join = { room, playback_state: playback, channel_epoch: 1, engine_session: B };
    expect(toResult({ ok: true, data: join }, JoinResult).ok).toBe(true);
    expect(toResult({ ok: true, data: { room } }, JoinResult)).toEqual({ ok: false, code: 'internal' });
  });

  it('list each code once and mark the silent ones', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(ERROR_CODES).toContain('voice_sync_failed');
    expect(SILENT_CODES).toEqual(['stale_seq', 'not_elected']);
  });
});

describe('extension messages', () => {
  it('validate the handover and replies', () => {
    const handover = {
      type: 'handover',
      room_id: ROOM,
      slug: 'aB3_xY9-kL',
      source: 'netflix',
      content_ref: 'https://www.netflix.com/watch/1',
      engine_session: B,
      session: { access_token: 'a', refresh_token: 'r' },
    };
    expect(HandoverMessage.safeParse(handover).success).toBe(true);
    expect(PageToExtension.safeParse({ type: 'ping' }).success).toBe(true);
    expect(PageToExtension.safeParse({ type: 'reclaim', room_id: ROOM }).success).toBe(true);
    expect(PageToExtension.safeParse({ type: 'other' }).success).toBe(false);
    expect(ExtensionReply.safeParse({ type: 'pong', version: 'x' }).success).toBe(true);
    expect(
      ExtensionReply.safeParse({ type: 'return', room_id: ROOM, session: { access_token: 'a', refresh_token: 'r' } })
        .success,
    ).toBe(true);
  });

  it('knows the paid sources', () => {
    expect(isPaidSource('netflix')).toBe(true);
    expect(isPaidSource('youtube')).toBe(false);
  });
});
