// Small fakes for the Edge Function tests: a Supabase client with in-memory tables, a LiveKit room
// service, and request builders.

import type { SupabaseClient } from '@supabase/supabase-js';
import { envFromRecord, type Env } from '../../functions/_shared/env.ts';
import type { ParticipantAdmin } from '../../functions/_shared/livekit.ts';

export const HOST = '11111111-1111-4111-8111-111111111111';
export const GUEST = '22222222-2222-4222-8222-222222222222';
export const STRANGER = '33333333-3333-4333-8333-333333333333';
export const ROOM = '44444444-4444-4444-8444-444444444444';
export const SESSION = '55555555-5555-4555-8555-555555555555';
export const OTHER_SESSION = '66666666-6666-4666-8666-666666666666';

export const SITE = 'http://localhost:3000';
export const PREVIEW = 'https://dev.watchparty.example';
export const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export function testEnv(extra: Record<string, string> = {}): Env {
  return envFromRecord({
    SITE_URL: SITE,
    PREVIEW_URL: `${PREVIEW}/`,
    EXTENSION_ORIGINS: ` ${EXTENSION} , chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba`,
    TURN_TEST_MODE: '1',
    LIVEKIT_URL: 'wss://livekit.example',
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-for-hmac-signing',
    ...extra,
  });
}

type Row = Record<string, unknown>;
interface Failure {
  message: string;
  status?: number;
}

/** Tables and auth in memory. `client(jwt)` returns something shaped like a SupabaseClient. */
export class FakeSupabase {
  tables: Record<string, Row[]> = { rooms: [], room_members: [], profiles: [] };
  /** JWT to user id. */
  users = new Map<string, string>();
  authDown = false;
  rpcResult: unknown = { ok: true, data: { channel_epoch: 1 } };
  rpcError: Failure | null = null;
  rpcCalls: Array<{ jwt: string | null; name: string; args: unknown }> = [];
  failSelect = new Set<string>();
  failUpdate = new Set<string>();
  updates: Array<{ table: string; values: Row; filters: Array<[string, unknown]> }> = [];
  deletedUsers: string[] = [];
  deleteError: Failure | null = null;

  client(jwt: string | null = null): SupabaseClient {
    // deno-lint-ignore no-this-alias
    const db = this;
    return {
      from: (table: string) => new FakeQuery(db, table),
      rpc: (name: string, args: unknown) => {
        db.rpcCalls.push({ jwt, name, args });
        return Promise.resolve(db.rpcError ? { data: null, error: db.rpcError } : { data: db.rpcResult, error: null });
      },
      auth: {
        getUser: (token: string) => {
          if (db.authDown) {
            return Promise.resolve({ data: { user: null }, error: { message: 'auth unavailable', status: 503 } });
          }
          const id = db.users.get(token);
          return Promise.resolve(
            id
              ? { data: { user: { id } }, error: null }
              : { data: { user: null }, error: { message: 'invalid JWT', status: 401 } },
          );
        },
        admin: {
          deleteUser: (id: string) => {
            if (db.deleteError) return Promise.resolve({ data: null, error: db.deleteError });
            db.deletedUsers.push(id);
            return Promise.resolve({ data: {}, error: null });
          },
        },
      },
    } as unknown as SupabaseClient;
  }
}

class FakeQuery {
  private readonly filters: Array<[string, unknown]> = [];
  private mode: 'select' | 'update' = 'select';
  private values: Row = {};
  private columns = '*';

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(columns = '*'): this {
    this.columns = columns;
    return this;
  }

  update(values: Row): this {
    this.mode = 'update';
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: Failure | null }> {
    if (this.db.failSelect.has(this.table)) {
      return Promise.resolve({ data: null, error: { message: `select on ${this.table} failed` } });
    }
    const row = this.matches()[0];
    return Promise.resolve({ data: row ? this.pick(row) : null, error: null });
  }

  then<T>(resolve: (value: { data: null; error: Failure | null }) => T, reject?: (err: unknown) => T): Promise<T> {
    const run = async () => {
      if (this.mode !== 'update') throw new Error('only updates are awaited directly in these tests');
      if (this.db.failUpdate.has(this.table)) return { data: null, error: { message: `update on ${this.table} failed` } };
      for (const row of this.matches()) Object.assign(row, this.values);
      this.db.updates.push({ table: this.table, values: this.values, filters: [...this.filters] });
      return { data: null, error: null };
    };
    return run().then(resolve, reject);
  }

  private matches(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((row) => this.filters.every(([c, v]) => row[c] === v));
  }

  /** Returns only the selected columns, so a query that asks for the wrong column fails the test. */
  private pick(row: Row): Row {
    if (this.columns.trim() === '*') return { ...row };
    const out: Row = {};
    for (const column of this.columns.split(',').map((c) => c.trim())) out[column] = row[column];
    return out;
  }
}

/** A room with a joined host and a joined guest, both present. */
export function seed(db: FakeSupabase, opts: { voiceMode?: 'mesh' | 'server'; status?: 'open' | 'closed' } = {}) {
  db.users.set('host-jwt', HOST);
  db.users.set('guest-jwt', GUEST);
  db.users.set('stranger-jwt', STRANGER);
  db.tables.rooms = [
    { id: ROOM, host_id: HOST, voice_mode: opts.voiceMode ?? 'mesh', status: opts.status ?? 'open', room_cap: 3 },
  ];
  db.tables.room_members = [
    { room_id: ROOM, user_id: HOST, role: 'host', state: 'joined', voice_muted: false, engine_session: OTHER_SESSION },
    { room_id: ROOM, user_id: GUEST, role: 'guest', state: 'joined', voice_muted: false, engine_session: SESSION },
  ];
  db.tables.profiles = [
    { id: HOST, display_name: 'Hana' },
    { id: GUEST, display_name: 'Gus' },
  ];
}

export function member(db: FakeSupabase, userId: string): Row {
  const row = db.tables.room_members?.find((m) => m.user_id === userId);
  if (!row) throw new Error('no such member');
  return row;
}

export function post(body: unknown, opts: { jwt?: string | null; origin?: string; raw?: string } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const jwt = opts.jwt === undefined ? 'guest-jwt' : opts.jwt;
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (opts.origin) headers.Origin = opts.origin;
  return new Request('http://localhost:54321/functions/v1/test', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

export function preflightRequest(origin: string | null): Request {
  const headers: Record<string, string> = {
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type',
  };
  if (origin) headers.Origin = origin;
  return new Request('http://localhost:54321/functions/v1/test', { method: 'OPTIONS', headers });
}

export async function body(res: Response): Promise<{ ok: boolean; code?: string; data?: unknown }> {
  return await res.json();
}

/** Records LiveKit calls; fails the first `failures` calls with `error`. */
export class FakeRoomService implements ParticipantAdmin {
  calls: Array<{ method: string; room: string; identity: string; options?: unknown }> = [];
  failures = 0;
  error: unknown = new Error('LiveKit unavailable');

  updateParticipant(room: string, identity: string, options: unknown): Promise<unknown> {
    this.calls.push({ method: 'updateParticipant', room, identity, options });
    return this.next();
  }

  removeParticipant(room: string, identity: string): Promise<unknown> {
    this.calls.push({ method: 'removeParticipant', room, identity });
    return this.next();
  }

  private next(): Promise<unknown> {
    if (this.failures > 0) {
      this.failures--;
      return Promise.reject(this.error);
    }
    return Promise.resolve({});
  }
}

/** Replaces console.error for one test and returns what was logged. */
export function captureErrors(): { lines: unknown[][]; restore: () => void } {
  const original = console.error;
  const lines: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args);
  };
  return { lines, restore: () => (console.error = original) };
}
