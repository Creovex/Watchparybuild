import { it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RoomController } from '../src/room/controller';
it('returns a recoverable error when realtime subscriptions reject during joining', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const stamp = new Date().toISOString();
  const room = {
    id,
    slug: 'abcdefghij',
    host_id: id,
    title: 'Room',
    visibility: 'private',
    source: 'youtube',
    content_ref: null,
    control_mode: 'host',
    wait_for_everyone: true,
    room_cap: 3,
    voice_mode: 'mesh',
    locked: false,
    status: 'open',
    channel_epoch: 1,
    created_at: stamp,
    last_active_at: stamp,
  };
  const playback = {
    room_id: id,
    seq: 0,
    status: 'paused',
    position_sec: 0,
    rate: 1,
    server_ts: stamp,
    paused_reason: 'user',
    updated_by: id,
  };
  const removed = vi.fn(async () => 'ok');
  const db = {
    rpc: async (name: string) => ({
      error: null,
      data: {
        ok: true,
        data:
          name === 'server_time'
            ? Date.now()
            : { room, playback_state: playback, channel_epoch: 1, engine_session: id },
      },
    }),
    realtime: { setAuth: async () => {} },
    removeChannel: removed,
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: (cb: (s: string) => void) => {
          cb('CHANNEL_ERROR');
          return channel;
        },
      };
      return channel;
    },
  } as unknown as SupabaseClient;
  const controller = new RoomController({
    supabase: db,
    me: { id, name: 'Test', avatarUrl: null },
    device: 'desktop',
    engine: 'page',
  });
  const result = await controller.join('abcdefghij', null, 'auto');
  expect(result).toEqual({ ok: false, code: 'internal' });
  expect(controller.store.get().status).toBe('idle');
  expect(removed).toHaveBeenCalledTimes(2);
});
