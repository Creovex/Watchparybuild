import { createAdminClient } from '../_shared/clients.ts';
import { deleteStoredMovie } from '../_shared/movie-handler.ts';
const admin = createAdminClient(Deno.env);
Deno.serve(async (req) => {
  const expected = Deno.env.get('MOVIE_CLEANUP_TOKEN');
  if (req.method !== 'POST' || !expected || req.headers.get('X-Movie-Cleanup-Token') !== expected)
    return new Response('Unauthorized', { status: 401 });
  try {
    const { data, error } = await admin
      .from('movies')
      .select('id,owner_id,lease_until')
      .eq('status', 'deleting')
      .limit(20);
    if (error) throw new Error('Cleanup listing failed');
    let cleaned = 0;
    for (const row of data ?? []) {
      if (row.lease_until && Date.parse(row.lease_until) > Date.now()) continue;
      const result = await deleteStoredMovie({ admin, env: Deno.env }, row.owner_id, row.id);
      if (result.ok) cleaned++;
    }
    return Response.json({ ok: true, cleaned });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
});
