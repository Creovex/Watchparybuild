import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isPresent, SOURCE_LABEL, type MemberRow, type RoomRow } from '@watchparty/sync-core';
import { Badge, Icon, SeatRow } from '@watchparty/ui';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getUser } from '@/lib/supabase/server';

export const metadata = { title: 'Your rooms' };

export default async function HomePage() {
  const { supabase, user } = await getUser();
  if (!user) redirect('/?next=/home');

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from('profiles').select('display_name, avatar_url, plan').eq('id', user.id).maybeSingle(),
    supabase.from('room_members').select('room_id').eq('user_id', user.id).eq('state', 'joined'),
  ]);
  const ids = (memberships ?? []).map((m: { room_id: string }) => m.room_id);
  const [{ data: rooms }, { data: members }] = ids.length
    ? await Promise.all([
        supabase.from('room_view').select('*').in('id', ids).order('last_active_at', { ascending: false }),
        supabase.from('room_members').select('room_id, state, last_seen_at').in('room_id', ids),
      ])
    : [{ data: [] }, { data: [] }];

  const now = Date.now();
  const presentCount = new Map<string, number>();
  for (const m of (members ?? []) as Pick<MemberRow, 'room_id' | 'state' | 'last_seen_at'>[]) {
    if (isPresent(m, now)) presentCount.set(m.room_id, (presentCount.get(m.room_id) ?? 0) + 1);
  }
  const all = (rooms ?? []) as RoomRow[];
  const open = all.filter((r) => r.status === 'open');
  const closed = all.filter((r) => r.status === 'closed').slice(0, 5);
  const plan = (profile?.plan as 'free' | 'paid' | undefined) ?? 'free';
  const cap = plan === 'paid' ? 10 : 3;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader profile={profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-8 sm:px-6 lg:py-12">
        <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <p className="slate">Signed in as {profile?.display_name ?? user.email}</p>
            <h1 className="marquee text-6xl sm:text-7xl">Your rooms</h1>
          </div>
          <Link
            href="/new"
            className="inline-flex min-h-13 items-center justify-center gap-2.5 rounded-lg bg-amber px-6 text-base font-semibold text-amber-ink hover:bg-amber-bright active:bg-amber-deep"
          >
            <Icon name="play" size={20} />
            Start a room
          </Link>
        </section>

        <section aria-labelledby="open-rooms" className="flex flex-col gap-3">
          <h2 id="open-rooms" className="slate">
            Open now
          </h2>
          {open.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong px-5 py-8">
              <Icon name="seat" size={28} className="text-faint" />
              <p className="text-lg font-semibold">No open rooms yet</p>
              <p className="max-w-[44ch] text-muted">
                Start one and send the link to whoever you want to watch with. Rooms you join from a link show up here too.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {open.map((room) => (
                <li key={room.id}>
                  <Link
                    href={`/r/${room.slug}`}
                    className="group flex min-h-24 items-center gap-4 rounded-xl bg-surface-1 px-4 py-4 ring-1 ring-line transition-colors hover:bg-surface-2 hover:ring-line-strong"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-lg font-bold">{room.title}</span>
                        {room.host_id === user.id ? (
                          <Badge tone="amber">
                            <Icon name="crown" size={12} />
                            Host
                          </Badge>
                        ) : null}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                        <span>{SOURCE_LABEL[room.source]}</span>
                        <span className="inline-flex items-center gap-1">
                          <Icon name={room.visibility === 'private' ? 'lock' : 'unlock'} size={14} />
                          {room.visibility === 'private' ? 'Private' : 'Public'}
                        </span>
                        {room.locked ? <span>Locked</span> : null}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <SeatRow cap={room.room_cap} taken={presentCount.get(room.id) ?? 0} size={18} />
                      <span className="text-xs text-faint">
                        {presentCount.get(room.id) ?? 0} of {room.room_cap} here
                      </span>
                    </div>
                    <Icon name="chevronRight" size={20} className="text-faint group-hover:text-text" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {closed.length ? (
          <section aria-labelledby="closed-rooms" className="flex flex-col gap-3">
            <h2 id="closed-rooms" className="slate">
              Recently closed
            </h2>
            <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
              {closed.map((room) => (
                <li key={room.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted">
                  <span className="truncate">{room.title}</span>
                  <span className="shrink-0">{SOURCE_LABEL[room.source]}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          aria-labelledby="plan"
          className="ticket flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"
          style={{ ['--ticket-bg' as string]: 'var(--color-surface-1)' }}
        >
          <div className="flex flex-col gap-1">
            <h2 id="plan" className="slate text-amber">
              Your plan · {plan === 'paid' ? 'Paid' : 'Free'}
            </h2>
            <p className="text-muted">
              Rooms you start seat {cap}, you included.
              {plan === 'free' ? ' Guests never need a paid plan.' : ''}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <SeatRow cap={cap} taken={cap} size={24} label={`${cap} seats per room`} />
            <Link href="/upgrade" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-amber hover:text-amber-bright">
              Compare plans
              <Icon name="chevronRight" size={16} />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
