import { describe, expect, it } from 'vitest';
import { androidDownload } from '../lib/android-release';
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
});
