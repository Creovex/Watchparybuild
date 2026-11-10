import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { envFromRecord } from '../../functions/_shared/env.ts';
import { MOVIE_PART_BYTES, partBytes, R2Storage, StorageError } from '../../functions/_shared/r2.ts';

const env = envFromRecord({ R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com', R2_BUCKET: 'test-movies', R2_ACCESS_KEY_ID: 'test-id', R2_SECRET_ACCESS_KEY: 'test-secret' });
function store(replies: Response[], requests: Request[] = []) {
  return new R2Storage(env, ((input: Request) => { requests.push(input); return Promise.resolve(replies.shift()!); }) as typeof fetch);
}
Deno.test('R2: part sizes include a smaller last part and refuse overflow', () => {
  assertEquals(partBytes(MOVIE_PART_BYTES + 17, 1), MOVIE_PART_BYTES);
  assertEquals(partBytes(MOVIE_PART_BYTES + 17, 2), 17);
  for (const [size, part] of [[0, 1], [1, 0], [1, 2], [1, 1.5], [6 * 1024 ** 3, 1]]) assertThrows(() => partBytes(size, part));
});
Deno.test('R2: part signatures bind length, key, multipart id and expiry', async () => {
  const url = new URL(await store([]).signPart('m/user/movie.mp4', 'id+/=', 2, 77));
  assertEquals(url.pathname, '/test-movies/m/user/movie.mp4');
  assertEquals(url.searchParams.get('uploadId'), 'id+/=');
  assertEquals(url.searchParams.get('partNumber'), '2');
  assertEquals(url.searchParams.get('X-Amz-Expires'), '3600');
  assert(url.searchParams.get('X-Amz-SignedHeaders')?.split(';').includes('content-length'));
  assert(!url.searchParams.has('X-Amz-SecretAccessKey'));
  const different = new URL(await store([]).signPart('m/user/movie.mp4', 'id+/=', 2, 78));
  assert(url.searchParams.get('X-Amz-Signature') !== different.searchParams.get('X-Amz-Signature'));
});
Deno.test('R2: playback signs a six hour GET without binding a Range header', async () => {
  const signed = await store([]).playUrl('m/user/movie.mp4');
  const url = new URL(signed.url);
  assertEquals(url.searchParams.get('X-Amz-Expires'), '21600');
  assertEquals(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert(Date.parse(signed.expires_at) > Date.now());
});
Deno.test('R2: listing paginates and decodes ETags', async () => {
  const requests: Request[] = [];
  const storage = store([
    new Response('<ListPartsResult><Part><PartNumber>1</PartNumber><ETag>&quot;first&quot;</ETag><Size>16777216</Size></Part><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker></ListPartsResult>'),
    new Response('<ListPartsResult><Part><PartNumber>2</PartNumber><ETag>&quot;second&quot;</ETag><Size>17</Size></Part><IsTruncated>false</IsTruncated></ListPartsResult>'),
  ], requests);
  assertEquals(await storage.parts('m/a.mp4', 'test'), [{ part_number: 1, etag: '"first"', size: MOVIE_PART_BYTES }, { part_number: 2, etag: '"second"', size: 17 }]);
  assertEquals(new URL(requests[1].url).searchParams.get('part-number-marker'), '1');
});
Deno.test('R2: completion escapes ETags and rejects embedded errors', async () => {
  const requests: Request[] = [];
  const storage = store([new Response('<Error><Code>InvalidPart</Code></Error>')], requests);
  await assertRejects(() => storage.complete('m/a.mp4', 'test', [{ part_number: 1, etag: '"abc&def"' }]), StorageError);
  assert((await requests[0].text()).includes('&quot;abc&amp;def&quot;'));
  await assertRejects(() => store([]).complete('m/a.mp4', 'test', [{ part_number: 2, etag: 'x' }]));
});
Deno.test('R2: missing objects and repeated cleanup are harmless', async () => {
  const storage = store([new Response(null, { status: 404 }), new Response(null, { status: 404 }), new Response(null, { status: 404 })]);
  assertEquals(await storage.head('m/a.mp4'), null);
  await storage.remove('m/a.mp4');
  await storage.abort('m/a.mp4', 'test');
});
Deno.test('R2: failures never expose provider response bodies', async () => {
  const error = await assertRejects(() => store([new Response('sensitive body', { status: 403 })]).create('m/a.mp4', 'video/mp4'), StorageError);
  assert(!error.message.includes('sensitive'));
});
Deno.test('R2: rejects unsafe endpoints and keys', async () => {
  assertThrows(() => new R2Storage(envFromRecord({ R2_ENDPOINT: 'http://remote.example' })));
  await assertRejects(() => store([]).playUrl('../movie.mp4'));
});
