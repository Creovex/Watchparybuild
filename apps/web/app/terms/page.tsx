import { Notice } from '@watchparty/ui';
import { PageShell } from '@/components/PageShell';
import { APP_NAME } from '@/lib/env';

export const metadata = { title: 'Terms' };

// Placeholder text until James supplies the real terms (gap G16).
export default function TermsPage() {
  return (
    <PageShell>
      <article className="flex flex-col gap-6">
        <h1 className="marquee text-6xl">Terms</h1>
        <Notice title="Placeholder for James">
          These terms are placeholder text written during the build. James replaces them before the app opens to the public
          (gap G16).
        </Notice>
        <div className="flex max-w-[65ch] flex-col gap-4 text-muted">
          <p>{APP_NAME} lets signed in people watch together in rooms, with synced playback, voice, chat and reactions.</p>
          <p>
            Each viewer uses their own subscription to Netflix, Prime Video or Disney+. {APP_NAME} never shows, records or
            redistributes their video, and never asks for or stores streaming service passwords.
          </p>
          <p>Hosts can remove and ban people from their rooms. Anyone can report a member; reports are reviewed by the people who run the app.</p>
          <p>Do not use rooms to harass anyone, to share sexual content without consent, or to spam.</p>
        </div>
      </article>
    </PageShell>
  );
}
