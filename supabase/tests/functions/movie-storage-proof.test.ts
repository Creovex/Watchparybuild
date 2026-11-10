import { assertEquals } from '@std/assert';
import type { SupabaseClient } from '@supabase/supabase-js';
import { envFromRecord } from '../../functions/_shared/env.ts';
import { createStorageProofHandler } from '../../functions/movie-storage-proof/handler.ts';
import type { MovieStorage } from '../../functions/_shared/r2.ts';
const owner = '11111111-1111-4111-8111-111111111111';
const key = `proof/${owner}/22222222-2222-4222-8222-222222222222.mp4`;
function harness(enabled = true, caller = owner) {
  const calls: string[] = [];
  const r2: MovieStorage = {
    create: async () => { calls.push('create'); return 'test-upload'; },
    parts: async () => [{ part_number: 1, etag: 'etag', size: 9 }],
    signPart: async () => 'https://test.invalid/signed',
    complete: async () => { calls.push('complete'); },
    head: async () => { calls.push('head'); return null; },
    abort: async () => { calls.push('abort'); },
    remove: async () => { calls.push('remove'); },
    playUrl: async () => ({ url: 'https://test.invalid/signed', expires_at: new Date().toISOString() }),
  };
  const handler = createStorageProofHandler({
    env: envFromRecord({ MOVIE_STORAGE_PROOF: enabled ? '1' : '0', MOVIE_UPLOADER_USER_ID: owner }),
    admin: {} as SupabaseClient, verify: async () => ({ id: caller }), r2,
  });
  return { calls, r2, run: async (body: unknown) => (await handler(new Request('https://test.invalid', {
    method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify(body),
  }))).json() };
}
Deno.test('storage proof: closed by default and rejects other users before storage access', async () => {
  for (const h of [harness(false), harness(true, 'other')]) {
    assertEquals(await h.run({ action: 'start', content_type: 'video/mp4' }), { ok: false, code: 'unauthorized' });
    assertEquals(h.calls, []);
  }
});
Deno.test('storage proof: cannot operate on library objects or another user namespace', async () => {
  for (const k of ['m/owner/movie.mp4', `proof/other/${key.split('/').at(-1)}`, `${key}/../movie.mp4`]) {
    const h = harness();
    assertEquals(await h.run({ action: 'play', key: k }), { ok: false, code: 'unauthorized' });
    assertEquals(h.calls, []);
  }
});
Deno.test('storage proof: enforces exact uploaded part sizes before completion', async () => {
  const h = harness();
  assertEquals(await h.run({ action: 'complete', key, upload_id: 'test', size_bytes: 10 }), { ok: false, code: 'invalid_input' });
  assertEquals(h.calls, ['head']);
});
Deno.test('storage proof: retries completion after object creation without repeating it', async () => {
  const h = harness();
  h.r2.head = async () => ({ size: 10, content_type: 'video/mp4' });
  assertEquals(await h.run({ action: 'complete', key, upload_id: 'test', size_bytes: 10 }), { ok: true, data: { size: 10, content_type: 'video/mp4' } });
  assertEquals(h.calls, []);
});
Deno.test('storage proof: cleanup aborts unfinished parts and removes completed object', async () => {
  const h = harness();
  assertEquals(await h.run({ action: 'cleanup', key, upload_id: 'test' }), { ok: true, data: {} });
  assertEquals(h.calls, ['abort', 'remove']);
});
