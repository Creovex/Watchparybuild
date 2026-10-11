import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Reads the local stack's address and keys from `supabase status`, and makes the local test video
// the stub adapter plays. The service role key used here is the local stack's own, never a hosted
// project's.
export default async function globalSetup() {
  const root = join(__dirname, '..');
  const status = execSync('pnpm exec supabase status -o env', { cwd: root, encoding: 'utf8' });
  const env: Record<string, string> = {};
  for (const line of status.split('\n')) {
    const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (match) env[match[1]!] = match[2]!;
  }
  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error('Start the local stack first: pnpm db:start');
  }
  const file = join(root, 'e2e', '.auth', 'stack.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY }));

  const video = join(root, 'apps', 'web', 'public', 'e2e', 'test.webm');
  if (!existsSync(video)) {
    mkdirSync(dirname(video), { recursive: true });
    // Three minutes of a test pattern with a running counter, small enough to load instantly.
    execFileSync('ffmpeg', [
      '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=180',
      '-c:v', 'libvpx', '-b:v', '200k', '-an', '-y', video,
    ]);
  }
}
