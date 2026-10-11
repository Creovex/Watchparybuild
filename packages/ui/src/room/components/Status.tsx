'use client';

import { formatTimecode } from '@watchparty/sync-core';
import { Icon } from '../../icons';
import { Button, cx } from '../../primitives';
import { useRoom } from '../hooks';
import { joinNames } from '../system-text';
import { useController } from './context';

/**
 * The film leader: 3, 2, 1 inside a circle with a crosshair, the hand sweeping once per second.
 * Shown to cue sync members before a synced start; never drawn over the YouTube player.
 */
export function CountdownLeader({ ms, className }: { ms: number; className?: string }) {
  const n = Math.max(1, Math.ceil(ms / 1000));
  return (
    <div className={cx('relative flex aspect-square items-center justify-center', className)} role="timer" aria-live="assertive">
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
        <circle cx="100" cy="100" r="92" fill="none" stroke="var(--color-line-strong)" strokeWidth="2" />
        <circle cx="100" cy="100" r="74" fill="none" stroke="var(--color-line)" strokeWidth="2" />
        <path d="M100 0v200M0 100h200" stroke="var(--color-line)" strokeWidth="2" />
        <circle
          key={n}
          cx="100"
          cy="100"
          r="83"
          fill="none"
          stroke="var(--color-amber)"
          strokeWidth="18"
          strokeOpacity="0.35"
          pathLength={100}
          strokeDasharray="100"
          className="leader-hand"
        />
      </svg>
      <span className="marquee relative text-[min(28vw,9rem)] leading-none text-text">{n}</span>
      <span className="sr-only">Starting in {n}</span>
    </div>
  );
}

/**
 * One line under the player saying what the sync engine is doing, with the two buttons the engine
 * can ask for: "Tap to watch together" when the browser blocks playback, and resync after it gives up.
 */
export function SyncStatus({ className }: { className?: string }) {
  const controller = useController();
  const state = useRoom(controller);
  const { engine, playback, status, online, members } = state;

  if (!online) {
    return <Line tone="red" icon="alert" className={className}>You&rsquo;re offline. The room reconnects when your connection is back.</Line>;
  }
  if (status === 'reconnecting') {
    return <Line tone="amber" icon="sync" className={className}>Reconnecting to the room…</Line>;
  }
  if (engine?.mode === 'blocked') {
    return (
      <div className={cx('px-3 py-2', className)}>
        <Button variant="primary" size="lg" block icon="play" onClick={() => void controller.engineHost?.tapToPlay()}>
          Tap to watch together
        </Button>
      </div>
    );
  }
  if (engine?.mode === 'cant_keep_up') {
    return (
      <div className={cx('px-3 py-2', className)}>
        <Button variant="secondary" block icon="sync" onClick={() => controller.engineHost?.resync()}>
          Can&rsquo;t keep up, tap to resync
        </Button>
      </div>
    );
  }
  if (playback?.status === 'paused' && playback.paused_reason === 'buffer') {
    const names = members.filter((m) => m.present && m.buffering_since).map((m) => m.name);
    return <Line tone="amber" icon="clock" className={className}>Waiting for {joinNames(names)} to catch up</Line>;
  }
  if (engine?.mode === 'countdown' && engine.countdownMs !== null) {
    return <Line tone="amber" icon="clock" className={className}>Starting together in {Math.ceil(engine.countdownMs / 1000)}</Line>;
  }
  if (engine?.mode === 'ended' || playback?.status === 'ended') {
    return <Line tone="muted" icon="check" className={className}>Finished</Line>;
  }
  if (engine?.manualSeek && engine.drift !== null && Math.abs(engine.drift) > 2) {
    return (
      <Line tone="amber" icon="info" className={className}>
        You&rsquo;re {Math.round(Math.abs(engine.drift))}s {engine.drift > 0 ? 'ahead' : 'behind'}. Seek manually to stay in sync.
      </Line>
    );
  }
  if (engine && engine.expected !== null) {
    const inSync = engine.drift === null || Math.abs(engine.drift) < 0.6;
    return (
      <Line tone={inSync ? 'green' : 'amber'} icon={inSync ? 'check' : 'sync'} className={className}>
        {/* The timecode changes every second; screen readers hear only the state when it changes. */}
        <span className="timecode text-text" aria-hidden="true">
          {formatTimecode(engine.local ?? engine.expected)}
        </span>
        <span>{engine.mode === 'paused' ? 'Paused' : inSync ? 'In sync' : 'Catching up'}</span>
      </Line>
    );
  }
  return null;
}

function Line({
  tone,
  icon,
  children,
  className,
}: {
  tone: 'green' | 'amber' | 'red' | 'muted';
  icon: Parameters<typeof Icon>[0]['name'];
  children: React.ReactNode;
  className?: string;
}) {
  const color = { green: 'text-green', amber: 'text-amber', red: 'text-red', muted: 'text-muted' }[tone];
  return (
    <p className={cx('flex min-h-10 items-center gap-2 px-3 text-sm text-muted', className)} role="status" data-testid="sync-status">
      <Icon name={icon} size={16} className={cx('shrink-0', color)} />
      {children}
    </p>
  );
}
