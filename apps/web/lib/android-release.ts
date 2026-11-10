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
