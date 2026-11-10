import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { verifyWithAuth, type VerifyJwt } from './clients.ts';
import type { Env } from './env.ts';
import { createHandler } from './handler.ts';
import { fail, isFunctionCode, type FunctionResult } from './http.ts';
import { MOVIE_MAX_BYTES, MOVIE_PART_BYTES, partBytes, R2Storage, type MovieStorage } from './r2.ts';

export type MovieOperation = 'start' | 'urls' | 'complete' | 'abort' | 'delete' | 'play';
export interface MovieDeps {
  env: Env;
  admin: SupabaseClient;
  verify?: VerifyJwt;
  r2?: MovieStorage;
}
const UUID = z.guid();
const Start = z.strictObject({
  movie_id: UUID,
  title: z.string().trim().min(1).max(120),
  size_bytes: z.number().int().min(1).max(MOVIE_MAX_BYTES),
  content_type: z.enum(['video/mp4', 'video/webm']),
  duration_sec: z.number().positive().finite(),
  width: z.number().int().min(1).max(16384),
  height: z.number().int().min(1).max(16384),
});
const MovieId = z.strictObject({ movie_id: UUID });
const Urls = z.strictObject({
  movie_id: UUID,
  part_numbers: z.array(z.number().int().min(1).max(320)).min(1).max(50),
});
const Play = z.union([MovieId, z.strictObject({ room_id: UUID, engine_session: UUID })]);
export const MovieInputs = {
  start: Start,
  urls: Urls,
  complete: MovieId,
  abort: MovieId,
  delete: MovieId,
  play: Play,
};
export interface StoredMovie {
  id: string;
  owner_id: string;
  title: string;
  status: string;
  size_bytes: number;
  content_type: string;
  duration_sec: number;
  width: number;
  height: number;
  object_key: string;
  upload_id: string | null;
  lease_token: string | null;
  poster_path: string | null;
  created_at: string;
  ready_at: string | null;
}
const publicFields = [
  'id',
  'owner_id',
  'title',
  'status',
  'size_bytes',
  'content_type',
  'duration_sec',
  'width',
  'height',
  'poster_path',
  'created_at',
  'ready_at',
] as const;
export function publicMovie(movie: StoredMovie) {
  return Object.fromEntries(publicFields.map((key) => [key, movie[key]]));
}
async function transition(
  admin: SupabaseClient,
  caller: string,
  action: string,
  input: Record<string, unknown>,
): Promise<FunctionResult<StoredMovie>> {
  const { data, error } = await admin.rpc('movie_storage_action', { caller, action, input });
  if (error) throw new Error('Movie metadata request failed');
  if (!data?.ok) return fail(isFunctionCode(data?.code) ? data.code : 'internal');
  return { ok: true, data: data.data };
}
async function owned(admin: SupabaseClient, caller: string, id: string): Promise<StoredMovie | null> {
  const { data, error } = await admin
    .from('movies')
    .select('*')
    .eq('id', id)
    .eq('owner_id', caller)
    .maybeSingle();
  if (error) throw new Error('Movie metadata request failed');
  return data;
}
export async function deleteStoredMovie(
  deps: MovieDeps,
  caller: string,
  id: string,
): Promise<FunctionResult<unknown>> {
  const claim = await transition(deps.admin, caller, 'delete', { movie_id: id });
  if (!claim.ok) return claim;
  const m = claim.data;
  if (m.status === 'failed') return { ok: true, data: {} };
  const storage = deps.r2 ?? new R2Storage(deps.env);
  if (m.upload_id) await storage.abort(m.object_key, m.upload_id);
  await storage.remove(m.object_key);
  const { error } = await deps.admin.storage.from('posters').remove([`${caller}/${id}.jpg`]);
  if (error) throw new Error('Poster cleanup failed');
  const done = await transition(deps.admin, caller, 'cleaned', { movie_id: id, lease_token: m.lease_token });
  return done.ok ? { ok: true, data: {} } : done;
}
export async function cleanupAccountMovies(deps: MovieDeps, caller: string): Promise<void> {
  const locked = await transition(deps.admin, caller, 'account_delete', {});
  if (!locked.ok) throw new Error('Account could not be prepared for deletion');
  const { data, error } = await deps.admin.from('movies').select('id').eq('owner_id', caller);
  if (error) throw new Error('Movie metadata request failed');
  for (const row of data ?? []) {
    const result = await deleteStoredMovie(deps, caller, row.id);
    if (!result.ok) throw new Error('Movie cleanup has not completed');
  }
  const removed = await deps.admin.from('movies').delete().eq('owner_id', caller).eq('status', 'failed');
  if (removed.error) throw new Error('Movie cleanup has not completed');
}
export function createMovieHandler(operation: MovieOperation, deps: MovieDeps) {
  return createHandler<unknown, unknown>({
    name: `movie-${operation}`,
    env: deps.env,
    verify: deps.verify ?? verifyWithAuth(deps.admin),
    input: MovieInputs[operation] as z.ZodType<unknown>,
    async run({ caller, input: raw }) {
      const input = raw as Record<string, unknown>;
      if (operation === 'play') {
        let movie: StoredMovie | null = null;
        if (input.movie_id) movie = await owned(deps.admin, caller.id, String(input.movie_id));
        else {
          const [room, member] = await Promise.all([
            deps.admin
              .from('rooms')
              .select('source,status,content_ref')
              .eq('id', input.room_id)
              .maybeSingle(),
            deps.admin
              .from('room_members')
              .select('state,engine_session')
              .eq('room_id', input.room_id)
              .eq('user_id', caller.id)
              .maybeSingle(),
          ]);
          if (room.error || member.error) throw new Error('Room access check failed');
          if (
            room.data?.source !== 'upload' ||
            room.data.status !== 'open' ||
            member.data?.state !== 'joined' ||
            member.data.engine_session !== input.engine_session
          )
            return fail('not_member');
          const result = await deps.admin
            .from('movies')
            .select('*')
            .eq('id', room.data.content_ref)
            .maybeSingle();
          if (result.error) throw new Error('Movie metadata request failed');
          movie = result.data;
        }
        if (!movie || movie.status !== 'ready') return fail('movie_unavailable');
        const limit = await transition(deps.admin, caller.id, 'play_rate', {});
        if (!limit.ok) return limit;
        return {
          ok: true,
          data: {
            ...(await (deps.r2 ?? new R2Storage(deps.env)).playUrl(movie.object_key)),
            movie: publicMovie(movie),
          },
        };
      }
      if (operation === 'delete' || operation === 'abort')
        return deleteStoredMovie(deps, caller.id, String(input.movie_id));
      const storage = deps.r2 ?? new R2Storage(deps.env);
      if (operation === 'start') {
        const reserved = await transition(deps.admin, caller.id, 'reserve', input);
        if (!reserved.ok) return reserved;
        const m = reserved.data;
        if (m.status !== 'uploading') return fail('upload_in_progress');
        if (!m.upload_id) {
          const id = await storage.create(m.object_key, m.content_type);
          const attached = await transition(deps.admin, caller.id, 'attach', {
            movie_id: m.id,
            upload_id: id,
          });
          if (!attached.ok) {
            await storage.abort(m.object_key, id);
            return attached;
          }
        }
        return {
          ok: true,
          data: {
            movie_id: m.id,
            part_size: MOVIE_PART_BYTES,
            part_count: Math.ceil(m.size_bytes / MOVIE_PART_BYTES),
          },
        };
      }
      if (operation === 'urls') {
        const m = await owned(deps.admin, caller.id, String(input.movie_id));
        if (!m || m.status !== 'uploading' || !m.upload_id) return fail('movie_unavailable');
        const requested = [...new Set(input.part_numbers as number[])];
        if (requested.some((p) => p > Math.ceil(m.size_bytes / MOVIE_PART_BYTES)))
          return fail('invalid_input');
        const uploaded = await storage.parts(m.object_key, m.upload_id);
        const urls = Object.fromEntries(
          await Promise.all(
            requested.map(async (p) => [
              p,
              await storage.signPart(m.object_key, m.upload_id!, p, partBytes(m.size_bytes, p)),
            ]),
          ),
        );
        return { ok: true, data: { urls, uploaded } };
      }
      const claim = await transition(deps.admin, caller.id, 'complete', { movie_id: input.movie_id });
      if (!claim.ok) return claim;
      const m = claim.data;
      if (m.status === 'ready') return { ok: true, data: { movie: publicMovie(m) } };
      let info = await storage.head(m.object_key);
      if (!info) {
        if (!m.upload_id) return fail('movie_unavailable');
        const parts = (await storage.parts(m.object_key, m.upload_id)).sort(
          (a, b) => a.part_number - b.part_number,
        );
        if (
          parts.length !== Math.ceil(m.size_bytes / MOVIE_PART_BYTES) ||
          parts.some((p, i) => p.part_number !== i + 1 || p.size !== partBytes(m.size_bytes, p.part_number))
        )
          return fail('size_mismatch');
        await storage.complete(m.object_key, m.upload_id, parts);
        info = await storage.head(m.object_key);
      }
      if (!info || info.size !== m.size_bytes || info.content_type !== m.content_type)
        return fail('size_mismatch');
      const ready = await transition(deps.admin, caller.id, 'ready', {
        movie_id: m.id,
        lease_token: m.lease_token,
        actual_size: info.size,
      });
      return ready.ok ? { ok: true, data: { movie: publicMovie(ready.data) } } : ready;
    },
  });
}
