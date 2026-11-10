// Local database checks for reservations and account deletion racing on separate connections.
import { createClient } from 'npm:@supabase/supabase-js';

const url = Deno.env.get('SUPABASE_URL') ?? '';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('This check is restricted to the local test stack.');
const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users: string[] = [];
const movies: { owner: string; id: string }[] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function action(caller: string, operation: string, input: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc('movie_storage_action', { caller, action: operation, input });
  if (error) throw new Error('Storage transition failed');
  return data;
}
async function user() {
  const { data, error } = await admin.auth.admin.createUser({
    email: `movie-race-${crypto.randomUUID()}@example.invalid`,
    email_confirm: true,
  });
  assert(!error && data.user, 'Could not create a local account');
  users.push(data.user.id);
  const grant = await admin.from('profiles').update({ upload_quota_bytes: 9_000_000_000 }).eq('id', data.user.id);
  assert(!grant.error, 'Could not configure a local quota');
  return data.user.id;
}
function reservation(owner: string, size: number) {
  const id = crypto.randomUUID();
  movies.push({ owner, id });
  return {
    movie_id: id, title: 'Concurrency fixture', size_bytes: size, content_type: 'video/mp4',
    duration_sec: 20, width: 160, height: 90,
  };
}
async function cleanup() {
  for (const movie of movies) {
    const deleted = await action(movie.owner, 'delete', { movie_id: movie.id });
    if (deleted.ok && deleted.data.status !== 'failed') {
      const released = await action(movie.owner, 'cleaned', {
        movie_id: movie.id, lease_token: deleted.data.lease_token,
      });
      assert(released.ok, 'Could not release a local reservation');
    }
    const removed = await admin.from('movies').delete().eq('id', movie.id).eq('status', 'failed');
    assert(!removed.error, 'Could not remove local metadata');
  }
  movies.length = 0;
}
try {
  const baseline = await admin.from('movies').select('id', { count: 'exact', head: true }).neq('status', 'failed');
  assert(!baseline.error && baseline.count === 0, 'Use an empty local movie database for this check');
  const [a, b] = await Promise.all([user(), user()]);
  const results = await Promise.all([
    action(a, 'reserve', reservation(a, 5 * 1024 ** 3)),
    action(b, 'reserve', reservation(b, 5 * 1024 ** 3)),
  ]);
  assert(results.filter((r) => r.ok).length === 1, 'Exactly one competing reservation must succeed');
  assert(results.filter((r) => r.code === 'storage_full').length === 1, 'The other reservation must respect the shared cap');
  console.log('PASS: parallel reservations cannot overfill the shared pool');
  await cleanup();

  const input = reservation(a, 100);
  const [reserve, deleting] = await Promise.all([
    action(a, 'reserve', input), action(a, 'account_delete'),
  ]);
  assert(deleting.ok, 'Account deletion must acquire the upload guard');
  assert(reserve.ok || reserve.code === 'upload_not_allowed', 'The racing reservation must be serialized');
  const retry = await action(a, 'reserve', input);
  assert(retry.code === 'upload_not_allowed', 'Account deletion must block a reservation retry');
  if (reserve.ok) {
    const attach = await action(a, 'attach', { movie_id: input.movie_id, upload_id: 'not-a-real-storage-upload' });
    assert(attach.code === 'upload_not_allowed', 'Account deletion must prevent attaching a new upload');
  }
  console.log('PASS: account deletion blocks both new reservations and storage attachment');
} finally {
  await cleanup();
  for (const id of users) {
    const result = await admin.auth.admin.deleteUser(id);
    assert(!result.error, 'Could not remove a local test account');
  }
}
