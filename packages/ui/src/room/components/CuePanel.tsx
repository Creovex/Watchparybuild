'use client';

import { useState, type ReactNode } from 'react';
import { contentUrl, describeOffset, formatTimecode, parseTimecode, SOURCE_LABEL } from '@watchparty/sync-core';
import { Icon } from '../../icons';
import { Button, cx, Notice } from '../../primitives';
import { useNow, useRoom } from '../hooks';
import { CountdownLeader } from './Status';
import { useController } from './context';

function useCueState() {
  const controller = useController();
  const state = useRoom(controller);
  useNow(250);
  const { room, playback } = state;
  if (!room || !playback) return null;
  const serverNow = controller.clock.now();
  const startAt = Date.parse(playback.server_ts);
  const countdownMs = playback.status === 'playing' && serverNow < startAt ? startAt - serverNow : null;
  return { controller, room, playback, countdownMs, expected: controller.expectedPosition(), service: SOURCE_LABEL[room.source] };
}

/**
 * Cue sync: for a member with no player the app can drive (a phone on a paid source, or a computer
 * without the sync extension). The screen shows where everyone is and counts down synced starts;
 * reactions and timed comments float over it, never over a YouTube player.
 */
export function CueScreen({ overlay, compact = false }: { overlay?: ReactNode; compact?: boolean }) {
  const cue = useCueState();
  if (!cue) return null;
  const { playback, countdownMs, expected, service } = cue;
  const statusLabel =
    countdownMs !== null ? 'Starting' : playback.status === 'playing' ? 'Playing' : playback.status === 'ended' ? 'Finished' : 'Paused';
  return (
    <div
      className={cx(
        'relative flex flex-col items-center justify-center gap-2 overflow-hidden bg-black px-4 text-center',
        compact ? 'min-h-36 py-4' : 'aspect-video rounded-xl ring-1 ring-line',
      )}
    >
      {countdownMs !== null ? (
        <>
          <CountdownLeader ms={countdownMs} className={compact ? 'h-32' : 'h-[72%]'} />
          <p className="font-semibold text-amber">Press play in {service} when the count reaches zero.</p>
        </>
      ) : (
        <>
          <p className="slate">{service} · guided sync</p>
          <p className="timecode text-[clamp(2.5rem,12vw,5rem)] leading-none text-text" data-testid="cue-expected">
            {formatTimecode(expected)}
          </p>
          <p
            className={cx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
              playback.status === 'playing' ? 'bg-green/15 text-green' : 'bg-surface-3 text-muted',
            )}
          >
            <Icon name={playback.status === 'playing' ? 'play' : 'pause'} size={14} />
            {statusLabel}
          </p>
        </>
      )}
      {overlay}
    </div>
  );
}

/** Opening the title, telling the room you're ready, "Where am I?", and a controller's controls. */
export function CueControls({ extensionSlot }: { extensionSlot?: ReactNode }) {
  const cue = useCueState();
  const [whereAmI, setWhereAmI] = useState('');
  // The expected position at the moment the member typed, so the offset does not grow while they read it.
  const [expectedAtEntry, setExpectedAtEntry] = useState(0);
  const [jumpTo, setJumpTo] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [readySent, setReadySent] = useState(false);
  if (!cue) return null;
  const { controller, room, playback, expected, service } = cue;
  const typed = parseTimecode(whereAmI);

  return (
    <section className="flex flex-col gap-4" aria-label="Guided sync">
      <div className="flex flex-col gap-2 sm:flex-row">
        {room.content_ref ? (
          <a
            href={contentUrl(room.source, room.content_ref)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-surface-3 px-4 text-sm font-semibold ring-1 ring-inset ring-line-strong hover:bg-line"
          >
            <Icon name="external" size={18} />
            Open in {service}
          </a>
        ) : (
          <Notice>The host hasn&rsquo;t picked a title yet.</Notice>
        )}
        {extensionSlot}
      </div>

      {playback.status !== 'playing' ? (
        <Button
          variant="secondary"
          icon="check"
          disabled={readySent}
          onClick={async () => {
            const res = await controller.cueReady();
            if (res.ok) {
              setReadySent(true);
              setTimeout(() => setReadySent(false), 10_000);
            }
          }}
        >
          {readySent ? 'Told the room you are ready' : `I'm paused at ${formatTimecode(expected)}`}
        </Button>
      ) : null}

      {controller.isController() ? (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3">
          <p className="slate">Room controls</p>
          {playback.status === 'playing' ? (
            <Button variant="primary" icon="pause" block onClick={() => void controller.cuePause()}>
              Pause for everyone
            </Button>
          ) : (
            <Button variant="primary" icon="play" block onClick={() => void controller.cuePlay()}>
              Play for everyone
            </Button>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const sec = parseTimecode(jumpTo);
              if (sec === null) {
                setJumpError('Type a time like 1:02:30 or 45:10.');
                return;
              }
              setJumpError(null);
              setJumpTo('');
              void controller.cueJumpTo(sec);
            }}
          >
            <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
              Jump to
              <input
                inputMode="numeric"
                placeholder="1:02:30"
                value={jumpTo}
                onChange={(e) => setJumpTo(e.target.value)}
                aria-invalid={jumpError ? true : undefined}
                className="timecode min-h-11 rounded-lg bg-surface-1 px-3 text-base ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-amber"
              />
            </label>
            <Button type="submit">Jump</Button>
          </form>
          {jumpError ? <p className="text-sm text-red">{jumpError}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Where am I?
          <span className="font-normal text-muted">Type the time your {service} player shows.</span>
          <input
            inputMode="numeric"
            placeholder="0:00"
            value={whereAmI}
            onChange={(e) => {
              setWhereAmI(e.target.value);
              setExpectedAtEntry(controller.expectedPosition());
            }}
            className="timecode min-h-11 rounded-lg bg-surface-1 px-3 text-base ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-amber"
          />
        </label>
        {typed !== null ? (
          <p className="text-sm font-semibold text-amber" role="status" data-testid="where-am-i">
            {describeOffset(typed - expectedAtEntry)}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function CuePanel({ extensionSlot, overlay }: { extensionSlot?: ReactNode; overlay?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <CueScreen overlay={overlay} />
      <CueControls extensionSlot={extensionSlot} />
    </div>
  );
}
