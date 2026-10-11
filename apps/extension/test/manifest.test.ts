import { describe, expect, it } from 'vitest';
import { appMatches, buildManifest, PANEL_PAGE, PUBLIC_KEY } from '../manifest.config';
import { pageOrigins } from '../src/shared/env';

describe('manifest', () => {
  const manifest = buildManifest({ NEXT_PUBLIC_APP_NAME: 'Synvello', NEXT_PUBLIC_SITE_URL: 'https://watch.example' }, '0.1.0');

  it('carries the fixed key and only the storage permission', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.key).toBe(PUBLIC_KEY);
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('lets only the app talk to the extension, with no wildcard hosts', () => {
    expect(manifest.externally_connectable.matches).toEqual(['http://localhost:3000/*', 'https://watch.example/*']);
    for (const match of manifest.externally_connectable.matches) expect(new URL(match.replace('/*', '/')).hostname).not.toContain('*');
  });

  it('adds the site only when it is not the local server', () => {
    expect(appMatches('http://localhost:3000')).toEqual(['http://localhost:3000/*']);
    expect(appMatches('http://127.0.0.1:3000')).toEqual(['http://localhost:3000/*']);
    expect(appMatches('not a url')).toEqual(['http://localhost:3000/*']);
    expect(appMatches(undefined)).toEqual(['http://localhost:3000/*']);
  });

  it('runs content scripts on watch pages only and exposes the panel only to the services', () => {
    expect(manifest.content_scripts[0]!.matches).toContain('https://www.netflix.com/watch/*');
    expect(manifest.content_scripts[0]!.matches).not.toContain('https://www.netflix.com/*');
    expect(manifest.web_accessible_resources).toEqual([
      {
        resources: [PANEL_PAGE],
        matches: expect.arrayContaining(['https://www.netflix.com/*', 'https://www.primevideo.com/*', 'https://www.disneyplus.com/*']),
      },
    ]);
    for (const match of manifest.web_accessible_resources[0]!.matches) expect(match).not.toContain('localhost');
  });

  it('accepts messages from the same origins it lists', () => {
    expect(pageOrigins('https://watch.example/')).toEqual(['http://localhost:3000', 'https://watch.example']);
    expect(pageOrigins('http://localhost:3000')).toEqual(['http://localhost:3000']);
  });
});
