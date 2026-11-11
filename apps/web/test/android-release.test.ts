import { describe, expect, it, vi } from 'vitest';
import { androidDownload, resolveAndroidDownload } from '../lib/android-release';
import websiteRelease from '../lib/android-release.json';
const url =
  'https://github.com/Creovex/Watchparybuild/releases/download/android-release/synvello.apk';
const app = {
  draft: false,
  prerelease: false,
  assets: [{ name: 'synvello.apk', size: 1234, browser_download_url: url }],
};
describe('Android downloads', () => {
  it('finds the app even when a newer release contains only extension assets', () => {
    expect(androidDownload([{ assets: [{ name: 'extension.zip' }] }, app])).toBe(url);
  });
  it('does not offer drafts, prereleases, empty files or downloads outside the official repository', () => {
    expect(
      androidDownload([
        { ...app, draft: true },
        { ...app, prerelease: true },
        { assets: [{ ...app.assets[0], size: 0 }] },
        {
          assets: [
            {
              ...app.assets[0],
              browser_download_url: 'https://example.com/synvello.apk',
            },
          ],
        },
      ]),
    ).toBe(null);
  });
  it('handles absent releases without offering a broken download', () => {
    expect(androidDownload([])).toBe(null);
    expect(androidDownload({ message: 'Not found' })).toBe(null);
  });
  it('keeps the verified website download available when GitHub is unavailable', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('https://api.github.com/')) throw new Error('Unavailable');
      return new Response(null, {
        headers: {
          'content-length': String(websiteRelease.size_bytes),
          'content-type': 'application/vnd.android.package-archive',
        },
      });
    });
    expect(await resolveAndroidDownload(fetcher)).toEqual({
      url: websiteRelease.url,
      failed: false,
    });
  });
  it('does not offer a missing or incorrect website artifact', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('https://api.github.com/')
        ? Response.json([])
        : new Response(null, { headers: { 'content-length': '1', 'content-type': 'text/html' } }),
    );
    expect(await resolveAndroidDownload(fetcher)).toEqual({ url: null, failed: true });
  });
  it('uses a newer official repository release when one is available', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('https://api.github.com/')
        ? Response.json([app])
        : new Response(null, { status: 404 }),
    );
    expect(await resolveAndroidDownload(fetcher)).toEqual({ url, failed: false });
  });
});
