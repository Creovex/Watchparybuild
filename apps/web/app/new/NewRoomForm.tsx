'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  isPaidSource,
  parseContentRef,
  SOURCE_LABEL,
  type ControlMode,
  type CreateRoomResult,
  type Source,
  type Visibility,
} from '@watchparty/sync-core';
import { Button, ChoiceGroup, Icon, Notice, SeatRow, TextField, useCopy } from '@watchparty/ui';
import { RoomApi } from '@watchparty/ui/room';
import { CLIENT_SENTENCES, errorSentence } from '@/lib/errors';
import { getBrowserClient } from '@/lib/supabase/client';

const SOURCE_OPTIONS: Array<{ value: Source; label: string }> = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'netflix', label: 'Netflix' },
  { value: 'prime', label: 'Prime Video' },
  { value: 'disney', label: 'Disney+' },
];

export function NewRoomForm({ cap }: { cap: number }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<Source>('youtube');
  const [link, setLink] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [controlMode, setControlMode] = useState<ControlMode>('host');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateRoomResult | null>(null);

  const parsed = useMemo(() => (link.trim() ? parseContentRef(source, link) : null), [source, link]);
  const linkError =
    touched && parsed && !parsed.ok
      ? parsed.reason === 'live_stream'
        ? CLIENT_SENTENCES.live_stream
        : source === 'youtube'
          ? CLIENT_SENTENCES.bad_youtube_link
          : CLIENT_SENTENCES.bad_title_link
      : null;
  const titleError = touched && !title.trim() ? 'Give the room a name, up to 80 characters.' : null;
  const youtubeId = source === 'youtube' && parsed?.ok ? parsed.ref : null;

  async function submit() {
    setTouched(true);
    if (!title.trim() || (parsed && !parsed.ok)) return;
    setBusy(true);
    setError(null);
    const res = await new RoomApi(getBrowserClient()).createRoom({
      title: title.trim().slice(0, 80),
      source,
      content_ref: parsed?.ok ? parsed.ref : null,
      visibility,
      control_mode: controlMode,
    });
    setBusy(false);
    if (!res.ok) {
      setError(errorSentence(res.code));
      return;
    }
    setCreated(res.data);
  }

  if (created) return <RoomTicket result={created} />;

  return (
    <form
      noValidate
      className="flex flex-col gap-7"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-2">
        <p className="slate">New room · seats {cap}</p>
        <h1 className="marquee text-6xl">Start a room</h1>
      </div>

      <TextField
        label="Room name"
        placeholder="Friday film club"
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
        error={titleError}
        hint="Everyone in the room sees this."
        autoComplete="off"
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold">What are you watching?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup">
          {SOURCE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg px-2 text-sm font-semibold ring-1 ring-inset transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-amber ${
                source === option.value ? 'bg-surface-3 text-amber ring-amber' : 'bg-surface-1 text-muted ring-line hover:text-text'
              }`}
            >
              <input
                type="radio"
                name="source"
                value={option.value}
                checked={source === option.value}
                onChange={() => setSource(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3">
        <TextField
          label={source === 'youtube' ? 'YouTube video link' : `${SOURCE_LABEL[source]} title address`}
          placeholder={source === 'youtube' ? 'https://www.youtube.com/watch?v=…' : `https://www.${source === 'prime' ? 'primevideo' : source === 'disney' ? 'disneyplus' : 'netflix'}.com/…`}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => link && setTouched(true)}
          error={linkError}
          optional
          inputMode="url"
          autoComplete="off"
          hint={
            source === 'youtube'
              ? 'A watch link, a youtu.be link, a Shorts link or the video id. You can pick it later in the room.'
              : 'Open the title on the service and copy the address from the address bar. You can add it later in the room.'
          }
        />
        {youtubeId ? (
          <div className="flex items-center gap-3 rounded-lg bg-surface-1 p-2 ring-1 ring-line">
            <img
              src={`https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`}
              alt=""
              width={120}
              height={68}
              referrerPolicy="no-referrer"
              className="aspect-video w-[120px] rounded-md bg-surface-3 object-cover"
            />
            <p className="flex items-center gap-1.5 text-sm text-green">
              <Icon name="check" size={16} />
              YouTube video found
            </p>
          </div>
        ) : null}
        {isPaidSource(source) ? (
          <Notice title={`Everyone needs their own ${SOURCE_LABEL[source]} subscription`}>
            Netflix, Prime and Disney+ play in their own app or tab here, so syncing is guided. YouTube syncs automatically
            everywhere. On a computer with the sync extension in Chrome or Edge, it syncs automatically too.
          </Notice>
        ) : null}
      </div>

      <ChoiceGroup
        legend="Who can join"
        name="visibility"
        value={visibility}
        onChange={setVisibility}
        options={[
          { value: 'private', label: 'Private', description: 'The link carries a secret key. Only people with it can join.', icon: 'lock' },
          { value: 'public', label: 'Public', description: 'Anyone signed in who has the link can join.', icon: 'unlock' },
        ]}
      />

      <ChoiceGroup
        legend="Who controls playback"
        name="control"
        value={controlMode}
        onChange={setControlMode}
        options={[
          { value: 'host', label: 'Only me', description: 'You play, pause and seek for everyone.', icon: 'crown' },
          { value: 'everyone', label: 'Everyone', description: 'Anyone in the room can play, pause and seek.', icon: 'people' },
        ]}
      />

      <div className="flex items-center gap-3 rounded-lg bg-surface-1 px-4 py-3 ring-1 ring-line">
        <SeatRow cap={cap} taken={cap} size={20} label={`${cap} seats`} />
        <p className="text-sm text-muted">
          Seats {cap}, you included.{' '}
          {cap === 3 ? (
            <Link href="/upgrade" className="font-semibold text-amber hover:text-amber-bright">
              Rooms of 10 are coming
            </Link>
          ) : null}
        </p>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      <Button type="submit" variant="primary" size="lg" busy={busy} icon="play">
        Start the room
      </Button>
    </form>
  );
}

/** The room's path and key, so "Go to the room" stays on this site whatever site_url says. */
function relativeLink(link: string): string {
  try {
    const url = new URL(link);
    return `${url.pathname}${url.hash}`;
  } catch {
    return link;
  }
}

function RoomTicket({ result }: { result: CreateRoomResult }) {
  const [copy, copied] = useCopy();
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const { room, room_link } = result;
  return (
    <div className="flex flex-col gap-6" data-testid="room-created">
      <div className="flex flex-col gap-2">
        <p className="slate text-green">Room ready</p>
        <h1 className="marquee text-6xl">Send the link</h1>
        <p className="text-muted">
          {room.visibility === 'private'
            ? 'This link includes the room key. Anyone with it can join, so share it only with the people you want.'
            : 'Anyone signed in who has this link can join.'}
        </p>
      </div>

      <div className="ticket flex flex-col gap-4 px-6 py-5" style={{ ['--ticket-bg' as string]: 'var(--color-surface-2)', ['--notch-y' as string]: '62%' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="slate text-amber">Admit {room.room_cap}</p>
            <p className="truncate text-xl font-bold">{room.title}</p>
          </div>
          <span className="text-sm text-muted">{SOURCE_LABEL[room.source]}</span>
        </div>
        <div className="perforation" />
        <p className="break-all font-mono text-sm text-text" data-testid="room-link">
          {room_link}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {canShare ? (
          <Button
            variant="primary"
            size="lg"
            icon="share"
            onClick={() => void navigator.share({ title: room.title, url: room_link }).catch(() => undefined)}
          >
            Share link
          </Button>
        ) : null}
        <Button variant={canShare ? 'secondary' : 'primary'} size="lg" icon={copied ? 'check' : 'copy'} onClick={() => void copy(room_link)}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        <a
          href={relativeLink(room_link)}
          className="inline-flex min-h-13 items-center justify-center gap-2 rounded-lg px-6 text-base font-semibold text-text ring-1 ring-inset ring-line-strong hover:bg-surface-3"
        >
          Go to the room
          <Icon name="chevronRight" size={20} />
        </a>
      </div>
    </div>
  );
}
