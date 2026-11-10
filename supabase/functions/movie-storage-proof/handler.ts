// Temporary, explicitly enabled owner-only proof. This is not the production upload API.
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyWithAuth, type VerifyJwt } from '../_shared/clients.ts';
import { readEnv, type Env } from '../_shared/env.ts';
import { createHandler } from '../_shared/handler.ts';
import { fail } from '../_shared/http.ts';
import { MOVIE_PART_BYTES, partBytes, R2Storage, type MovieStorage } from '../_shared/r2.ts';

const SIZE = z.number().int().min(1).max(250 * 1024 * 1024);
const key = z.string().max(200);
const upload = { key, upload_id: z.string().min(1).max(2048), size_bytes: SIZE };
export const ProofInput = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start'), content_type: z.enum(['video/mp4', 'video/webm']) }),
  z.strictObject({ action: z.literal('urls'), ...upload }),
  z.strictObject({ action: z.literal('complete'), ...upload }),
  z.strictObject({ action: z.literal('play'), key }),
  z.strictObject({ action: z.literal('cleanup'), key, upload_id: z.string().min(1).max(2048) }),
]);

export function createStorageProofHandler(deps: {
  env: Env; admin: SupabaseClient; verify?: VerifyJwt; r2?: MovieStorage;
}) {
  return createHandler<z.infer<typeof ProofInput>, unknown>({
    name: 'movie-storage-proof', env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin), input: ProofInput,
    async run({ caller, input }) {
      // Closed by default, including when the operator accidentally deploys the function.
      if (readEnv(deps.env, 'MOVIE_STORAGE_PROOF') !== '1' ||
        readEnv(deps.env, 'MOVIE_UPLOADER_USER_ID') !== caller.id) return fail('unauthorized');
      const storage = deps.r2 ?? new R2Storage(deps.env);
      if (input.action === 'start') {
        const objectKey = `proof/${caller.id}/${crypto.randomUUID()}.${input.content_type === 'video/mp4' ? 'mp4' : 'webm'}`;
        return { ok: true, data: { key: objectKey, upload_id: await storage.create(objectKey, input.content_type), part_size: MOVIE_PART_BYTES } };
      }
      const prefix = `proof/${caller.id}/`;
      if (!input.key.startsWith(prefix) || !/^[0-9a-f-]{36}\.(mp4|webm)$/.test(input.key.slice(prefix.length))) return fail('unauthorized');
      if (input.action === 'cleanup') {
        await storage.abort(input.key, input.upload_id);
        await storage.remove(input.key);
        return { ok: true, data: {} };
      }
      if (input.action === 'play') {
        const info = await storage.head(input.key);
        if (!info) return fail('not_found');
        return { ok: true, data: { ...await storage.playUrl(input.key), ...info } };
      }
      if (input.action === 'urls') {
        const count = Math.ceil(input.size_bytes / MOVIE_PART_BYTES);
        const urls = await Promise.all(Array.from({ length: count }, async (_, i) => ({
          part_number: i + 1,
          url: await storage.signPart(input.key, input.upload_id, i + 1, partBytes(input.size_bytes, i + 1)),
        })));
        return { ok: true, data: { urls } };
      }
      // Reconcile a completion whose successful response was lost.
      const existing = await storage.head(input.key);
      if (existing) return existing.size === input.size_bytes ? { ok: true, data: existing } : fail('invalid_input');
      const parts = await storage.parts(input.key, input.upload_id);
      parts.sort((a, b) => a.part_number - b.part_number);
      if (parts.length !== Math.ceil(input.size_bytes / MOVIE_PART_BYTES) ||
        parts.some((p, i) => p.part_number !== i + 1 || p.size !== partBytes(input.size_bytes, p.part_number))) return fail('invalid_input');
      await storage.complete(input.key, input.upload_id, parts);
      const info = await storage.head(input.key);
      if (!info || info.size !== input.size_bytes) {
        await storage.remove(input.key);
        return fail('invalid_input');
      }
      return { ok: true, data: info };
    },
  });
}
