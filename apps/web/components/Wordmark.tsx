import Link from 'next/link';
import { APP_NAME } from '@/lib/env';

/** The app name set like a marquee: condensed capitals in tungsten amber. */
export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="marquee inline-flex min-h-11 items-center gap-2 text-[1.75rem] text-amber no-underline"
      aria-label={`${APP_NAME} home`}
    >
      <span aria-hidden="true" className="inline-flex flex-col gap-[3px]">
        <span className="size-[5px] rounded-full bg-amber" />
        <span className="size-[5px] rounded-full bg-amber/60" />
        <span className="size-[5px] rounded-full bg-amber/30" />
      </span>
      {APP_NAME}
    </Link>
  );
}
