import Link from 'next/link';
import { Wordmark } from '@/components/Wordmark';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Wordmark />
      <p className="marquee text-[clamp(5rem,20vw,10rem)] leading-none text-line-strong" aria-hidden="true">
        404
      </p>
      <h1 className="text-2xl font-bold">There&rsquo;s nothing showing here</h1>
      <p className="max-w-[40ch] text-muted">The address may be mistyped, or the page has moved.</p>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-amber px-5 font-semibold text-amber-ink hover:bg-amber-bright">
        Go to the start
      </Link>
    </div>
  );
}
