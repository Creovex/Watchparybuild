import { assertEquals } from '@std/assert';
import { createDeleteAccountHandler } from '../../functions/delete-account/handler.ts';
import { FakeSupabase, GUEST, HOST, body, captureErrors, post, seed, testEnv } from './fakes.ts';

const OTHER_ROOM = '88888888-8888-4888-8888-888888888888';
const CLOSED_ROOM = '99999999-9999-4999-8999-999999999999';

function setup() {
  const db = new FakeSupabase();
  seed(db);
  db.tables.rooms.push(
    { id: OTHER_ROOM, host_id: GUEST, voice_mode: 'mesh', status: 'open' },
    { id: CLOSED_ROOM, host_id: HOST, voice_mode: 'mesh', status: 'closed' },
  );
  const handler = createDeleteAccountHandler({ env: testEnv(), admin: db.client() });
  return { db, handler };
}

Deno.test('delete-account: closes the open rooms the caller hosts, then deletes the user', async () => {
  const { db, handler } = setup();
  const res = await handler(post(undefined, { jwt: 'host-jwt', raw: '' }));
  assertEquals(res.status, 200);
  assertEquals(await body(res), { ok: true, data: null });
  assertEquals(db.updates, [
    {
      table: 'rooms',
      values: { status: 'closed' },
      filters: [
        ['host_id', HOST],
        ['status', 'open'],
      ],
    },
  ]);
  assertEquals(
    db.tables.rooms.map((r) => [r.host_id, r.status]),
    [
      [HOST, 'closed'],
      [GUEST, 'open'],
      [HOST, 'closed'],
    ],
  );
  assertEquals(db.deletedUsers, [HOST]);
});

Deno.test('delete-account: accepts an empty JSON object as no input', async () => {
  const { db, handler } = setup();
  const res = await handler(post({}, { jwt: 'guest-jwt' }));
  assertEquals(res.status, 200);
  assertEquals(db.deletedUsers, [GUEST]);
});

Deno.test('delete-account: invalid_input when a body carries fields', async () => {
  const { db, handler } = setup();
  const res = await handler(post({ user_id: GUEST }, { jwt: 'host-jwt' }));
  assertEquals(res.status, 400);
  assertEquals(await body(res), { ok: false, code: 'invalid_input' });
  assertEquals(db.deletedUsers, []);
});

Deno.test('delete-account: unauthorized without a valid JWT, and nothing changes', async () => {
  const { db, handler } = setup();
  const res = await handler(post({}, { jwt: 'forged' }));
  assertEquals(res.status, 401);
  assertEquals(await body(res), { ok: false, code: 'unauthorized' });
  assertEquals(db.updates, []);
  assertEquals(db.deletedUsers, []);
});

Deno.test('delete-account: internal when rooms cannot be closed, and the user is kept', async () => {
  const { db, handler } = setup();
  db.failUpdate.add('rooms');
  const errors = captureErrors();
  try {
    const res = await handler(post({}, { jwt: 'host-jwt' }));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'internal' });
    assertEquals(db.deletedUsers, []);
  } finally {
    errors.restore();
  }
});

Deno.test('delete-account: internal when the user cannot be deleted', async () => {
  const { db, handler } = setup();
  db.deleteError = { message: 'database error deleting user' };
  const errors = captureErrors();
  try {
    const res = await handler(post({}, { jwt: 'host-jwt' }));
    assertEquals(res.status, 500);
    assertEquals(await body(res), { ok: false, code: 'internal' });
    assertEquals(errors.lines.length, 1);
  } finally {
    errors.restore();
  }
});
