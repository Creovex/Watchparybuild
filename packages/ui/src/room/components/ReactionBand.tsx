'use client';

import { formatTimecode, type MessageRow } from '@watchparty/sync-core';
import { cx } from '../../primitives';
import type { FloatingReaction, TimedPopup } from '../controller';

/**
 * The strip directly under the player: marks for timed comments on a thin track, reactions rising
 * for 2 seconds, and timed comments shown for 4 seconds when playback passes them. Nothing here
 * ever covers the player itself.
 */
export function ReactionBand({
  reactions,
  popups,
  timed,
  duration,
  nameOf,
  className,
  transparent = false,
}: {
  reactions: FloatingReaction[];
  popups: TimedPopup[];
  timed: MessageRow[];
  duration: number | null;
  nameOf: (id: string | null) => string;
  className?: string;
  /** Float over another surface (the cue sync screen) instead of sitting in its own strip. */
  transparent?: boolean;
}) {
  const latest = popups[popups.length - 1];
  return (
    <div
      className={cx(
        'relative h-12 shrink-0 overflow-hidden',
        transparent ? 'pointer-events-none' : 'border-b border-line/60 bg-ink',
        className,
      )}
      data-testid="reaction-band"
    >
      {duration && duration > 0 ? (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-surface-3" aria-hidden="true">
          {timed.map((m) =>
            m.position_sec === null ? null : (
              <span
                key={m.id}
                className="absolute top-0 h-full w-[3px] -translate-x-1/2 rounded-full bg-amber"
                style={{ left: `${Math.min(100, (m.position_sec / duration) * 100)}%` }}
              />
            ),
          )}
        </div>
      ) : null}
      <div aria-hidden="true">
        {reactions.map((r) => (
          <span
            key={r.id}
            className="absolute bottom-1 animate-rise text-2xl leading-none will-change-transform"
            style={{ left: `${r.x * 100}%`, ['--drift-x' as string]: `${r.drift}px` }}
          >
            {r.emoji}
          </span>
        ))}
      </div>
      {latest ? (
        <div
          key={latest.id}
          className="absolute inset-x-3 bottom-2 flex animate-pop-in justify-center"
          data-testid="timed-popup"
        >
          <p className="max-w-full truncate rounded-full bg-surface-3 px-3 py-1.5 text-sm ring-1 ring-inset ring-line-strong">
            <span className="timecode mr-2 text-amber">{formatTimecode(latest.position)}</span>
            <span className="font-semibold">{nameOf(latest.userId)}</span>
            <span className="text-muted">: {latest.body}</span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
