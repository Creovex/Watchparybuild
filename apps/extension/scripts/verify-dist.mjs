// Checks the built extension in dist/ before it is loaded or published:
//   1. the manifest carries the fixed key (extension id appcjgbhipnbklhodimgbmjhbncljoip),
//   2. it asks for the storage permission only,
//   3. externally_connectable lists exact origins with no wildcard hosts,
//   4. the panel page is web accessible to the streaming services only,
//   5. no secret appears in any built file: no JWT (JSON Web Token) with a role other than anon,
//      no Supabase secret key, and none of the secret values found in the environment or in the
//      repository's git ignored env files. Secret values are compared, never printed.
// Run after `pnpm build`: `pnpm --filter @watchparty/extension verify-dist`.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(here, '..');
const repoRoot = resolve(extensionDir, '../..');
const dist = join(extensionDir, 'dist');
const EXPECTED_ID = 'appcjgbhipnbklhodimgbmjhbncljoip';
const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'CLOUDFLARE_TURN_KEY_ID',
  'CLOUDFLARE_TURN_API_TOKEN',
];

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json is missing. Run the build first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

function idFromKey(key) {
  const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

check(manifest.manifest_version === 3, 'manifest_version is 3');
check(typeof manifest.key === 'string' && idFromKey(manifest.key) === EXPECTED_ID, `key gives the extension id ${EXPECTED_ID}`);
check(JSON.stringify(manifest.permissions) === JSON.stringify(['storage']), 'permissions are storage only');
check(!manifest.optional_permissions && !manifest.optional_host_permissions, 'no optional permissions');

const external = manifest.externally_connectable?.matches ?? [];
const hostOf = (pattern) => pattern.replace(/^[a-z]+:\/\//, '').split('/')[0];
check(external.includes('http://localhost:3000/*'), 'externally_connectable includes http://localhost:3000/*');
check(external.length > 0 && external.every((p) => !hostOf(p).includes('*')), 'externally_connectable has no wildcard hosts');
check(!external.some((p) => hostOf(p).includes('vercel.app') && hostOf(p).includes('*')), 'no vercel.app wildcard');

const panelEntry = (manifest.web_accessible_resources ?? []).find((r) => r.resources.includes('src/panel/panel.html'));
const services = /^https:\/\/www\.(netflix\.com|primevideo\.com|disneyplus\.com|amazon\.(com|co\.uk|de|ca))\/\*$/;
check(Boolean(panelEntry) && panelEntry.matches.every((m) => services.test(m)), 'panel page is web accessible to the streaming services only');
check(
  (manifest.web_accessible_resources ?? []).every((r) => r.matches.every((m) => services.test(m))),
  'every web accessible resource is limited to the streaming services',
);

// Secrets ------------------------------------------------------------------------------------------

function envFileValues(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const envFiles = [
  '.env',
  '.env.local',
  'apps/web/.env.local',
  'apps/extension/.env.local',
  'supabase/functions/.env',
  'supabase/.env',
].map((p) => join(repoRoot, p));
const secretValues = new Set();
for (const source of [process.env, ...envFiles.map(envFileValues)]) {
  for (const name of SECRET_NAMES) {
    const value = source[name];
    if (value && value.length >= 8) secretValues.add(value);
  }
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const textFiles = files(dist).filter((p) => /\.(js|mjs|html|css|json|map|txt)$/.test(p));
const leaks = [];
for (const path of textFiles) {
  const text = readFileSync(path, 'utf8');
  for (const value of secretValues) if (text.includes(value)) leaks.push(`${relative(dist, path)}: a secret value from the environment`);
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) leaks.push(`${relative(dist, path)}: a Supabase secret key`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role !== 'anon') leaks.push(`${relative(dist, path)}: a JWT with role ${payload.role ?? 'unknown'}`);
    } catch {
      leaks.push(`${relative(dist, path)}: an unreadable JWT`);
    }
  }
}
check(leaks.length === 0, `no secret in ${textFiles.length} built files (${secretValues.size} secret values from env files compared)`);
for (const leak of leaks) console.log(`  ${leak}`);

if (failures.length) {
  console.error(`${failures.length} check(s) failed.`);
  process.exit(1);
}
