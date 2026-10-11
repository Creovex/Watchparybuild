'use client';

import { Button } from '@watchparty/ui';
import { errorSentence } from '@/lib/errors';

// No raw error text, stack trace or code is ever shown; the sentence for `internal` stands in.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="marquee text-5xl">Something stalled</h1>
      <p className="max-w-[40ch] text-muted">{errorSentence('internal')}</p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
