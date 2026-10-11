import { Icon } from '@watchparty/ui';
import { PageShell } from '@/components/PageShell';

export const metadata = { title: 'Sync extension' };

export default function ExtensionPage() {
  return (
    <PageShell>
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <p className="slate">Chrome and Edge on a computer</p>
          <h1 className="marquee text-6xl">The sync extension</h1>
          <p className="text-lg text-muted">
            Netflix, Prime Video and Disney+ protect their video, so no other website can show it or press play on it. The
            extension runs inside your own Netflix, Prime Video or Disney+ tab and keeps it in step with the room, with chat,
            voice and reactions in a panel beside the film.
          </p>
        </div>

        <section aria-labelledby="what" className="flex flex-col gap-3">
          <h2 id="what" className="text-xl font-bold">
            What it can see
          </h2>
          <ul className="flex flex-col gap-2 text-muted">
            <li className="flex gap-2">
              <Icon name="check" size={18} className="mt-1 shrink-0 text-green" />
              Which title is playing, where it is, how fast, whether it is paused or buffering, and its volume.
            </li>
            <li className="flex gap-2">
              <Icon name="close" size={18} className="mt-1 shrink-0 text-red" />
              Nothing else: not your streaming password, not your history, not other tabs.
            </li>
          </ul>
        </section>

        <section aria-labelledby="install" className="flex flex-col gap-4">
          <h2 id="install" className="text-xl font-bold">
            Install it
          </h2>
          <p className="text-muted">
            The extension is not in the Chrome Web Store or Edge Add-ons yet. While the app is being tested, install it from
            the folder you were given.
          </p>
          <ol className="flex flex-col gap-4">
            {[
              ['Open the extensions page', 'In Chrome go to chrome://extensions. In Edge go to edge://extensions.'],
              ['Turn on developer mode', 'Chrome: the switch at the top right. Edge: the switch in the left column.'],
              ['Load the folder', 'Choose "Load unpacked" and pick the extension folder (apps/extension/dist).'],
              ['Pin it', 'Pin it from the puzzle piece menu so you can see when it is connected.'],
              ['Open your room', 'Back in your room, choose "Open in Netflix with sync" (or Prime Video, Disney+).'],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="timecode flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm text-amber">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="without" className="flex flex-col gap-2 rounded-xl bg-surface-1 p-5 ring-1 ring-line">
          <h2 id="without" className="font-bold">
            Without the extension
          </h2>
          <p className="text-muted">
            You can still watch along with guided sync: the room counts down 3, 2, 1 and you press play in your own tab.
            Phones always use guided sync for these services. YouTube syncs automatically everywhere, no extension needed.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
