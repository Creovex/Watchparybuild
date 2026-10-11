import { Avatar, Icon, SeatRow } from '@watchparty/ui';

// A still of a room in use, drawn with the same parts the real room uses. It shows what the product
// does: one picture, people around it, a voice ring, reactions, and a note pinned to a moment.

export function RoomArt() {
  return (
    <figure className="relative mx-auto w-full max-w-xl" aria-label="A room in use: three seats, two people watching, one talking">
      <div className="overflow-hidden rounded-2xl bg-surface-1 ring-1 ring-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <p className="truncate text-sm font-semibold">Friday film club</p>
          <SeatRow cap={3} taken={2} size={18} label="2 of 3 seats taken" />
        </div>

        <div className="relative aspect-video bg-black">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-90"
            style={{
              background:
                'radial-gradient(120% 90% at 30% 20%, oklch(0.42 0.06 60) 0%, oklch(0.22 0.03 50) 45%, oklch(0.12 0.01 40) 100%)',
            }}
          />
          <div aria-hidden="true" className="absolute inset-x-[12%] bottom-[18%] h-[22%] rounded-[50%] bg-black/50 blur-xl" />
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/70 px-2.5 py-1">
            <span className="size-2 rounded-full bg-green" aria-hidden="true" />
            <span className="timecode text-xs text-text">1:12:04</span>
            <span className="text-xs text-muted">in sync</span>
          </div>
        </div>

        <div className="relative h-12 border-b border-line bg-surface-1" aria-hidden="true">
          <div className="absolute inset-x-0 top-0 h-[3px] bg-surface-3">
            <span className="absolute left-[38%] top-0 h-full w-[3px] rounded-full bg-amber" />
            <span className="absolute left-[71%] top-0 h-full w-[3px] rounded-full bg-amber" />
          </div>
          <span className="absolute left-[20%] top-3 text-xl">🔥</span>
          <span className="absolute left-[27%] top-1 text-xl opacity-70">😂</span>
          <span className="absolute left-[64%] top-2.5 text-xl">🍿</span>
          <span className="absolute right-4 top-3 max-w-[46%] truncate rounded-full bg-surface-3 px-3 py-1 text-xs text-text">
            <span className="timecode text-amber">1:11:58</span> the score in this bit
          </span>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <Avatar name="Jamie Moss" size={36} speaking />
            <Avatar name="Ana Lindqvist" size={36} />
            <span className="inline-flex size-9 items-center justify-center rounded-full border border-dashed border-line-strong text-faint">
              <Icon name="seat" size={18} />
            </span>
          </div>
          <p className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <Icon name="mic" size={16} className="text-green" />
            Jamie is talking
          </p>
        </div>
      </div>
      <figcaption className="sr-only">
        Two people watching the same film in sync, one talking, with reactions and a comment pinned to 1:11:58.
      </figcaption>
    </figure>
  );
}
