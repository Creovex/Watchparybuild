import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };
import { extensionEnv } from './env.config.ts';
import { allServiceOrigins, allWatchPages } from './src/shared/watch-pages.ts';

// The extension manifest. `manifest_version` is the value the Chrome Web Store requires. The `key`
// is the public half of the key pair made for this project (the private half stays outside the
// repository; see scripts/key-instructions.md), so every unpacked install gets the extension id
// appcjgbhipnbklhodimgbmjhbncljoip.

export const PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvtA7XcK9PKsdeCI+ooIpSlCOsssqCrpolKz7OC4gtHS6zuhNaoQS15AwgwsMH18V0UntXENPoKio90PyaMONOr6yd7cZgPM/pRAdXFLP6a367zPPPdtNpSHXV9Pozj158b8jPYPDtYmGbqyusEG7tNCUYVEoX6x9BQ5HaDYesZ3d/j3tZ2bqD2WFoGyOEhUcWWPBgpzlhVFGNyg40b4yuMEm8gUz4TD+8wKlXidV1rNiXpjOpgBCgkqwCT+qoPwieMzNJi9o7OPELJm0xQUZuDB5d9ZoTqrQ/EUBZ0m8jKs04iL1z/8NI2BQbJ/86clD4qxxEjd+tuvVLynDIOgR7wIDAQAB';

export const LOCAL_APP = 'http://localhost:3000/*';
export const PANEL_PAGE = 'src/panel/panel.html';

/** `http://localhost:3000/*`, plus the site's own origin when it is not the local one. No wildcards. */
export function appMatches(siteUrl: string | undefined): string[] {
  const matches = [LOCAL_APP];
  if (!siteUrl) return matches;
  try {
    const url = new URL(siteUrl);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!local && (url.protocol === 'https:' || url.protocol === 'http:')) matches.push(`${url.origin}/*`);
  } catch {
    // A malformed site address adds nothing.
  }
  return matches;
}

export function buildManifest(vars: Record<string, string | undefined>, version: string) {
  const appName = vars.NEXT_PUBLIC_APP_NAME || 'Watchparty';
  const app = appMatches(vars.NEXT_PUBLIC_SITE_URL);
  return {
    manifest_version: 3 as const,
    name: `${appName} sync`,
    short_name: appName,
    description: 'Keeps Netflix, Prime Video and Disney+ in step with your watch party room, with chat and voice beside the film.',
    version,
    key: PUBLIC_KEY,
    minimum_chrome_version: '116',
    permissions: ['storage'],
    host_permissions: [...allWatchPages(), ...app],
    background: { service_worker: 'src/background.ts', type: 'module' as const },
    content_scripts: [{ matches: allWatchPages(), js: ['src/content/index.ts'], run_at: 'document_idle' as const }],
    externally_connectable: { matches: app },
    web_accessible_resources: [{ resources: [PANEL_PAGE], matches: allServiceOrigins() }],
  };
}

export default defineManifest((env) => buildManifest(extensionEnv(env.mode), pkg.version));
