import { Notice } from '@watchparty/ui';
import { PageShell } from '@/components/PageShell';
import { APP_NAME } from '@/lib/env';

export const metadata = { title: 'Privacy' };

// Placeholder text until James supplies the real privacy notice (gap G16).
export default function PrivacyPage() {
  return (
    <PageShell>
      <article className="flex flex-col gap-6">
        <h1 className="marquee text-6xl">Privacy</h1>
        <Notice title="Placeholder for James">
          This notice is placeholder text written during the build. James replaces it before the app opens to the public (gap
          G16).
        </Notice>
        <div className="flex max-w-[65ch] flex-col gap-4 text-muted">
          <h2 className="text-lg font-bold text-text">What is stored</h2>
          <p>
            Your Google account&rsquo;s name, email address and profile photo; the rooms you start and join; chat messages
            and timed comments; and reports you send. Voice and camera are never recorded.
          </p>
          <h2 className="text-lg font-bold text-text">What is not</h2>
          <p>
            {APP_NAME} has no analytics or tracking scripts. The sync extension reads only which title is playing, where it
            is, its speed, whether it is paused or buffering, and its volume.
          </p>
          <h2 className="text-lg font-bold text-text">Deleting your account</h2>
          <p>
            Settings has a button that closes the rooms you host and deletes your profile. Your chat messages stay in their
            rooms, shown as &ldquo;Deleted user&rdquo;.
          </p>
        </div>
      </article>
    </PageShell>
  );
}
