import Link from 'next/link';
export const metadata = { title: 'Synvello for Android' };
async function downloadUrl(): Promise<string | null> {
  try {
    const response = await fetch('https://api.github.com/repos/Creovex/Watchparybuild/releases/latest', {
      next: { revalidate: 300 },
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const release = await response.json();
    const asset = release.assets?.find((a: { name: string }) => a.name === 'synvello.apk');
    return typeof asset?.browser_download_url === 'string' &&
      asset.browser_download_url.startsWith('https://github.com/Creovex/Watchparybuild/releases/download/')
      ? asset.browser_download_url
      : null;
  } catch {
    return null;
  }
}
export default async function AndroidPage() {
  const url = await downloadUrl();
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 p-6">
      <Link href="/home">Back to Synvello</Link>
      <h1 className="marquee text-6xl">Synvello for Android</h1>
      <p>
        Your movies, watch parties, voice and chat in one app. You need an internet connection and Chrome on
        your phone.
      </p>
      {url ? (
        <>
          <a href={url} className="rounded-lg bg-amber p-4 text-center font-semibold text-amber-ink">
            Download Android app
          </a>
          <ol className="list-inside list-decimal space-y-3">
            <li>Download the app file.</li>
            <li>If Android asks, allow your browser to install this app.</li>
            <li>Open the downloaded file and follow the installation prompts.</li>
          </ol>
        </>
      ) : (
        <p>The Android download is not available yet. You can use every available feature on the website.</p>
      )}
      <p className="text-sm text-muted">
        For iPhone, open Synvello in Safari and choose Add to Home Screen from the share menu.
      </p>
    </main>
  );
}
