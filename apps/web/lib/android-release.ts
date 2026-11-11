import websiteRelease from './android-release.json';

const PREFIX = 'https://github.com/Creovex/Watchparybuild/releases/download/';
export function androidDownload(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) continue;
    const asset = release.assets.find(
      (candidate: { name?: string; size?: number; browser_download_url?: string }) =>
        candidate.name === 'synvello.apk' &&
        typeof candidate.size === 'number' &&
        candidate.size > 0 &&
        typeof candidate.browser_download_url === 'string' &&
        candidate.browser_download_url.startsWith(PREFIX),
    );
    if (asset) return asset.browser_download_url;
  }
  return null;
}

export async function resolveAndroidDownload(
  fetcher: typeof fetch = fetch,
): Promise<{ url: string | null; failed: boolean }> {
  const [github, website] = await Promise.allSettled([
    fetcher('https://api.github.com/repos/Creovex/Watchparybuild/releases?per_page=20', {
      next: { revalidate: 300 },
      headers: { Accept: 'application/vnd.github+json' },
    }),
    fetcher(websiteRelease.url, { method: 'HEAD', next: { revalidate: 300 } }),
  ]);
  if (github.status === 'fulfilled' && github.value.ok) {
    try {
      const url = androidDownload(await github.value.json());
      if (url) return { url, failed: false };
    } catch {
      // The published website artifact remains available if the release feed fails.
    }
  }
  if (
    website.status === 'fulfilled' &&
    website.value.ok &&
    Number(website.value.headers.get('content-length')) === websiteRelease.size_bytes &&
    website.value.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/vnd.android.package-archive')
  ) {
    return { url: websiteRelease.url, failed: false };
  }
  return { url: null, failed: true };
}
