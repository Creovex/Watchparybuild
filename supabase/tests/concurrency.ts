// Concurrency check for join_room, run against the local Supabase stack.
//
// Five people call join_room at the same moment on a free host's room (room cap 3) while the host
// is present. Exactly two must be admitted and three refused with room_full. Each person has their
// own client, so the five calls reach the database as five parallel requests on separate
// connections. pgTAP runs in one session and cannot test this.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from the local stack; see
// supabase/tests/README.md. Exits with status 1 when any round fails.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env` (see supabase/tests/README.md).',
  );
  Deno.exit(1);
}

const ROUNDS = 5;
const JOINERS = 5;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const createdUsers: string[] = [];
const createdRooms: string[] = [];

async function signedInUser(label: string): Promise<{ id: string; client: SupabaseClient }> {
  const email = `concurrency-${label}-${crypto.randomUUID()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
  createdUsers.push(data.user.id);
  const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`could not sign in ${label}: ${signIn.error.message}`);
  return { id: data.user.id, client };
}

async function round(n: number): Promise<boolean> {
  const host = await signedInUser(`host${n}`);
  const joiners = await Promise.all(
    Array.from({ length: JOINERS }, (_, i) => signedInUser(`guest${n}-${i + 1}`)),
  );

  const created = await host.client.rpc('create_room', {
    title: `Concurrency ${n}`,
    source: 'youtube',
    content_ref: 'dQw4w9WgXcQ',
    visibility: 'public',
    control_mode: 'host',
  });
  if (created.error || !created.data?.ok) {
    throw new Error(`create_room failed: ${created.error?.message ?? JSON.stringify(created.data)}`);
  }
  const room = created.data.data.room as { id: string; slug: string; room_cap: number };
  createdRooms.push(room.id);

  const results = await Promise.all(
    joiners.map((j) => j.client.rpc('join_room', { slug: room.slug, join_key: null, sync_mode: 'auto' })),
  );
  const codes = results.map((r) => (r.error ? `error: ${r.error.message}` : r.data?.ok ? 'ok' : r.data?.code));
  const admitted = codes.filter((c) => c === 'ok').length;
  const full = codes.filter((c) => c === 'room_full').length;

  const { count } = await admin
    .from('room_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('room_id', room.id)
    .eq('state', 'joined');

  const passed = room.room_cap === 3 && admitted === 2 && full === JOINERS - 2 && count === 3;
  console.log(
    `round ${n}: room cap ${room.room_cap}, results [${codes.join(', ')}], joined rows ${count}: ${passed ? 'PASS' : 'FAIL'}`,
  );
  return passed;
}

let failed = false;
try {
  for (let n = 1; n <= ROUNDS; n++) {
    if (!(await round(n))) failed = true;
  }
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  for (const roomId of createdRooms) {
    await admin.from('rooms').delete().eq('id', roomId);
  }
  for (const userId of createdUsers) {
    await admin.auth.admin.deleteUser(userId);
  }
}

console.log(
  failed
    ? `FAIL: ${JOINERS} simultaneous joins on a free room with its host present did not always admit exactly 2`
    : `PASS: in ${ROUNDS} rounds, ${JOINERS} simultaneous joins on a free room with its host present admitted exactly 2`,
);
Deno.exit(failed ? 1 : 0);
