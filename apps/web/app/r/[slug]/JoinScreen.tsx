'use client';

import Link from 'next/link';
import { isPaidSource, SOURCE_LABEL, type ErrorCode, type RoomPreview } from '@watchparty/sync-core';
import { Button, Icon, Notice, SeatRow } from '@watchparty/ui';
import type { FatalKind } from '@watchparty/ui/room';
import { DevEmailSignIn, GoogleSignInButton } from '@/components/SignIn';
import { Wordmark } from '@/components/Wordmark';
import { errorSentence } from '@/lib/errors';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top px-4 sm:px-6">
        <Wordmark />
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </div>
  );
}

export function SignedOutGate({ slug }: { slug: string }) {
  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <p className="slate">You&rsquo;re invited</p>
        <h1 className="marquee text-6xl">Join the room</h1>
        <p className="text-muted">Sign in to see what&rsquo;s playing and take your seat. Everyone in a room is signed in.</p>
      </div>
      <GoogleSignInButton next={`/r/${slug}`} />
      <p className="text-sm text-faint">
        Netflix, Prime Video and Disney+ need your own subscription. YouTube needs nothing.
      </p>
      <DevEmailSignIn next={`/r/${slug}`} />
    </Shell>
  );
}

export function JoinScreen({
  preview,
  error,
  roomCap,
  busy,
  onJoin,
}: {
  preview: RoomPreview | null;
  error: ErrorCode | null;
  roomCap?: number;
  busy: boolean;
  onJoin: () => void;
}) {
  if (!preview) {
    return (
      <Shell>
        <div className="flex flex-col gap-3">
          <p className="slate">Room link</p>
          <h1 className="marquee text-6xl">{error === 'not_member' ? 'You left this room' : 'No room here'}</h1>
          <p className="text-muted">{errorSentence(error ?? 'not_found')}</p>
        </div>
        <Link href="/home" className="inline-flex min-h-11 items-center gap-2 font-semibold text-amber">
          <Icon name="chevronLeft" size={18} />
          Your rooms
        </Link>
      </Shell>
    );
  }

  const closed = preview.status === 'closed';
  const full = preview.present_count >= preview.room_cap;
  const blocking = error && ['closed', 'banned', 'removed', 'not_found'].includes(error);
  return (
    <Shell>
      <div className="flex flex-col gap-3">
        <p className="slate">
          {preview.visibility === 'private' ? 'Private room' : 'Public room'} · {SOURCE_LABEL[preview.source]}
        </p>
        <h1 className="text-4xl font-bold leading-tight [overflow-wrap:anywhere]" data-testid="preview-title">
          {preview.title}
        </h1>
        <div className="flex items-center gap-3">
          <SeatRow cap={preview.room_cap} taken={Math.min(preview.present_count, preview.room_cap)} />
          <span className="text-sm text-muted">
            {preview.present_count} of {preview.room_cap} here now
          </span>
        </div>
        {preview.locked ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Icon name="lock" size={16} />
            Locked: only people who were here before can come back in.
          </p>
        ) : null}
      </div>

      {isPaidSource(preview.source) ? (
        <Notice title={`You need your own ${SOURCE_LABEL[preview.source]} subscription`}>
          Netflix, Prime and Disney+ play in their own app or tab here, so syncing is guided. YouTube syncs automatically
          everywhere.
        </Notice>
      ) : null}

      {error || (full && !closed) ? (
        <div data-testid="join-error">
          <Notice tone="error">{errorSentence(error ?? 'room_full', { roomCap: roomCap ?? preview.room_cap })}</Notice>
        </div>
      ) : null}

      {closed || blocking ? (
        <Link href="/home" className="inline-flex min-h-11 items-center gap-2 font-semibold text-amber">
          <Icon name="chevronLeft" size={18} />
          Your rooms
        </Link>
      ) : (
        <Button variant="primary" size="lg" icon="seat" busy={busy} onClick={onJoin} disabled={full && !error}>
          {full ? 'Room is full' : 'Take your seat'}
        </Button>
      )}
    </Shell>
  );
}

const FATAL: Record<Exclude<FatalKind, 'left' | 'not_member' | 'handed_over'>, { title: string; body: (cap?: number) => string }> = {
  removed: { title: 'You were removed', body: () => 'You were removed from this room.' },
  banned: { title: 'You were removed', body: () => 'You were removed from this room.' },
  closed: { title: 'Room closed', body: () => 'This room was closed.' },
  replaced: { title: 'Opened elsewhere', body: () => 'You opened this room somewhere else.' },
  room_full: { title: 'Room full', body: (cap) => errorSentence('room_full', { roomCap: cap }) },
};

export function FatalScreen({ kind, roomCap, onRejoin }: { kind: FatalKind; roomCap?: number; onRejoin: () => void }) {
  const entry = FATAL[kind as keyof typeof FATAL];
  if (!entry) return null;
  return (
    <Shell>
      <div className="flex flex-col gap-3" role="alert" data-testid="room-fatal">
        <p className="slate">The room</p>
        <h1 className="marquee text-6xl">{entry.title}</h1>
        <p className="text-lg text-muted">{entry.body(roomCap)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {kind === 'replaced' ? (
          <Button variant="primary" icon="sync" onClick={onRejoin}>
            Watch here instead
          </Button>
        ) : null}
        <Link
          href="/home"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 font-semibold text-text ring-1 ring-inset ring-line-strong hover:bg-surface-3"
        >
          Your rooms
        </Link>
      </div>
    </Shell>
  );
}
