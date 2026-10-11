import { Icon, SeatRow, type IconName } from '@watchparty/ui';
import { PageShell } from '@/components/PageShell';

export const metadata = { title: 'Plans' };

const rows: Array<{ label: string; free: string; paid: string; icon: IconName }> = [
  { label: 'Seats in rooms you start', free: '3, you included', paid: '10, you included', icon: 'seat' },
  { label: 'Voice', free: 'Direct between the three of you', paid: 'Through a voice server, built for ten', icon: 'mic' },
  { label: 'Cameras', free: 'Optional, small and light on data', paid: 'Optional, adjusted to each viewer', icon: 'camera' },
  { label: 'Guests', free: 'Free', paid: 'Free', icon: 'people' },
];

export default function UpgradePage() {
  return (
    <PageShell width="max-w-4xl">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-3">
          <p className="slate">Plans</p>
          <h1 className="marquee text-6xl sm:text-7xl">Free seats three. Paid seats ten.</h1>
          <p className="max-w-[52ch] text-lg text-muted">
            Only the person who starts a room needs a plan. Everyone they invite joins free. Paid plans are coming soon.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <PlanCard name="Free" price="Yours now" cap={3} highlight={false} />
          <PlanCard name="Paid" price="Coming soon" cap={10} highlight />
        </div>

        <div className="overflow-hidden rounded-xl ring-1 ring-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Free and paid plans compared</caption>
            <thead className="bg-surface-2 text-muted">
              <tr>
                <th scope="col" className="px-3 py-3 font-semibold sm:px-4">
                  <span className="sr-only">Feature</span>
                </th>
                <th scope="col" className="px-3 py-3 font-semibold sm:px-4">Free</th>
                <th scope="col" className="px-3 py-3 font-semibold sm:px-4">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-3 py-3 font-semibold sm:px-4">
                    <span className="flex items-center gap-2">
                      <Icon name={row.icon} size={18} className="shrink-0 text-amber" />
                      {row.label}
                    </span>
                  </th>
                  <td className="px-3 py-3 text-muted sm:px-4">{row.free}</td>
                  <td className="px-3 py-3 text-muted sm:px-4">{row.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}

function PlanCard({ name, price, cap, highlight }: { name: string; price: string; cap: number; highlight: boolean }) {
  return (
    <section
      className={`ticket flex flex-col gap-4 p-6 ${highlight ? '' : ''}`}
      style={{ ['--ticket-bg' as string]: highlight ? 'var(--color-surface-3)' : 'var(--color-surface-1)' }}
      aria-label={`${name} plan`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="marquee text-4xl">{name}</h2>
        <p className={`slate ${highlight ? 'text-amber' : ''}`}>{price}</p>
      </div>
      <div className="perforation" />
      <SeatRow cap={cap} taken={cap} size={cap > 3 ? 22 : 30} label={`${cap} seats`} />
      <p className="text-muted">Rooms of {cap}, host included.</p>
    </section>
  );
}
