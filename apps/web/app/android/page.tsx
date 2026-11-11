import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { resolveAndroidDownload } from '@/lib/android-release';
export const metadata = { title: 'Synvello for Android' };
export default async function AndroidPage() {
  const { url, failed } = await resolveAndroidDownload();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 p-6">
        <Link href="/home">Back to Synvello</Link>
        <h1 className="marquee text-5xl sm:text-6xl">Synvello for Android</h1>
        <p>
          Your movies, watch parties, voice and chat in one app. You need an internet connection and
          Chrome on your phone.
        </p>
        {url ? (
          <>
            <a
              href={url}
              className="rounded-lg bg-amber p-4 text-center font-semibold text-amber-ink"
            >
              Download Android app
            </a>
            <ol className="list-inside list-decimal space-y-3">
              <li>Download the app file.</li>
              <li>If Android asks, allow your browser to install this app.</li>
              <li>Open the downloaded file and follow the installation prompts.</li>
            </ol>
          </>
        ) : (
          <section className="rounded-xl bg-surface-1 p-5 ring-1 ring-line">
            <h2 className="text-xl font-bold">
              {failed ? 'Download unavailable right now' : 'Android download coming soon'}
            </h2>
            <p className="mt-2 text-muted">
              {failed
                ? 'We could not check the Android download. Try this page again shortly.'
                : 'The installable Android app is being prepared. You can watch, chat and join private rooms on the website meanwhile.'}
            </p>
            {failed ? (
              <a href="/android" className="mt-3 inline-flex min-h-11 items-center underline">
                Try again
              </a>
            ) : null}
          </section>
        )}
        <Link
          href="/home"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 font-semibold"
        >
          Continue on the website
        </Link>
        <p className="text-sm text-muted">
          For iPhone, open Synvello in Safari and choose Add to Home Screen from the share menu.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
