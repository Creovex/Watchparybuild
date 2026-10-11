import Link from 'next/link';
import { APP_NAME } from '@/lib/env';

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{APP_NAME}. No ads, no tracking, no recordings.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link className="inline-flex min-h-11 items-center hover:text-text" href="/extension">
            Sync extension
          </Link>
          <Link className="inline-flex min-h-11 items-center hover:text-text" href="/upgrade">
            Plans
          </Link>
          <Link className="inline-flex min-h-11 items-center hover:text-text" href="/terms">
            Terms
          </Link>
          <Link className="inline-flex min-h-11 items-center hover:text-text" href="/privacy">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
