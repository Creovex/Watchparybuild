import { Icon, Notice, type IconName } from '@watchparty/ui';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { DevEmailSignIn, GoogleSignInButton } from '@/components/SignIn';
import { RoomArt } from '@/components/RoomArt';

const steps = [
  { n: '01', title: 'Start a room', body: 'Pick a YouTube video, or a title on Netflix, Prime Video or Disney+.' },
  { n: '02', title: 'Send the link', body: 'Share it in any chat. Private rooms carry a key in the link.' },
  { n: '03', title: 'Press play', body: 'Everyone starts together, and the room keeps you within a fraction of a second.' },
];

const extras: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'mic', title: 'Talk while you watch', body: 'Voice with the movie turned down while someone speaks. Camera if you want it.' },
  { icon: 'chat', title: 'Chat', body: 'Messages arrive in under a second. Pin one to the moment it is about.' },
  { icon: 'smile', title: 'React', body: 'Eight reactions that float past for two seconds, never over the picture.' },
  { icon: 'clock', title: 'Wait for everyone', body: "If someone's stream stalls, the room pauses until they catch up." },
];

export default async function Landing({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = params.next;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16 lg:pt-20">
          <div className="flex flex-col gap-6">
            <p className="slate">Now showing in two living rooms at once</p>
            <h1 className="marquee text-marquee text-text">
              Press play <span className="text-amber">together</span>, from anywhere.
            </h1>
            <p className="max-w-[34rem] text-lg text-muted">
              Start a room, send the link, and watch YouTube, Netflix, Prime Video or Disney+ in step with people who
              can&rsquo;t be on the sofa with you. Talk over it, react, and leave notes at the best moments.
            </p>

            {params.signin === 'failed' ? (
              <Notice tone="error">Sign in did not finish. Try again.</Notice>
            ) : null}

            <div className="ticket flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" style={{ ['--ticket-bg' as string]: 'var(--color-surface-2)' }}>
              <div className="flex flex-col gap-1 sm:pl-2">
                <p className="slate text-amber">Admit one</p>
                <p className="text-sm text-muted">Sign in to start a room or join one you were sent.</p>
              </div>
              <GoogleSignInButton next={next} />
            </div>
            <p className="max-w-[34rem] text-sm text-faint">
              Everyone watching needs their own Netflix, Prime Video or Disney+ subscription. YouTube needs nothing.
            </p>
            <DevEmailSignIn next={next} />
          </div>
          <RoomArt />
        </section>

        <section aria-labelledby="how" className="border-y border-line bg-surface-1">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 id="how" className="marquee text-4xl text-text">
              How it works
            </h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {steps.map((step) => (
                <li key={step.n} className="flex flex-col gap-2">
                  <span className="timecode text-sm text-amber">{step.n}</span>
                  <h3 className="text-xl font-bold">{step.title}</h3>
                  <p className="max-w-[28ch] text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="where" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col gap-3">
              <h2 id="where" className="marquee text-4xl">
                Where it syncs
              </h2>
              <p className="max-w-[40ch] text-muted">
                Netflix, Prime Video and Disney+ play in their own app or tab, so syncing there is guided with a countdown
                unless you are on a computer with the sync extension. YouTube syncs automatically everywhere.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl ring-1 ring-line">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">How each service syncs on phones and computers</caption>
                <thead className="bg-surface-2 text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-3 sm:px-4 font-semibold">Service</th>
                    <th scope="col" className="px-3 py-3 sm:px-4 font-semibold">Phone</th>
                    <th scope="col" className="px-3 py-3 sm:px-4 font-semibold">Computer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr>
                    <th scope="row" className="px-3 py-3 sm:px-4 font-semibold">YouTube</th>
                    <td className="px-3 py-3 sm:px-4"><SyncCell kind="auto" /></td>
                    <td className="px-3 py-3 sm:px-4"><SyncCell kind="auto" /></td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-3 py-3 sm:px-4 font-semibold">Netflix, Prime Video, Disney+</th>
                    <td className="px-3 py-3 sm:px-4"><SyncCell kind="guided" /></td>
                    <td className="px-3 py-3 sm:px-4">
                      <SyncCell kind="auto" note="with the sync extension in Chrome or Edge" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="extras" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
          <h2 id="extras" className="sr-only">
            What else a room has
          </h2>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {extras.map((item) => (
              <li key={item.title} className="flex flex-col gap-2 border-t border-line pt-5">
                <Icon name={item.icon} size={24} className="text-amber" />
                <h3 className="font-bold">{item.title}</h3>
                <p className="text-sm text-muted">{item.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-sm text-faint">
            Free rooms seat 3, host included. Rooms of 10 arrive with paid plans. Guests never pay.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function SyncCell({ kind, note }: { kind: 'auto' | 'guided'; note?: string }) {
  return (
    <span className="flex flex-col">
      <span className={kind === 'auto' ? 'font-semibold text-green' : 'font-semibold text-amber'}>
        {kind === 'auto' ? 'Automatic' : 'Guided countdown'}
      </span>
      {note ? <span className="text-faint">{note}</span> : null}
    </span>
  );
}
