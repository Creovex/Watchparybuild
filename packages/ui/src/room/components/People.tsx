'use client';

import { useEffect, useRef } from 'react';
import { Icon } from '../../icons';
import { Avatar, Badge, cx, IconButton } from '../../primitives';
import type { MemberView } from '../controller';
import { useRoom } from '../hooks';
import { useController } from './context';

/** Everyone in the room, with the host's moderation actions behind each member's menu. */
export function PeopleList({ onMemberMenu, speaking }: { onMemberMenu: (m: MemberView) => void; speaking: Set<string> }) {
  const controller = useController();
  const { members, room } = useRoom(controller);
  const joined = members.filter((m) => m.state === 'joined');
  const here = joined.filter((m) => m.present);
  const away = joined.filter((m) => !m.present);
  const removed = members.filter((m) => m.state === 'removed');
  const isHost = room?.host_id === controller.userId;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3" data-testid="people">
      <Section title={`Here now · ${here.length} of ${room?.room_cap ?? 0}`}>
        {here.map((m) => (
          <MemberRowItem key={m.user_id} member={m} speaking={speaking.has(m.user_id)} onMenu={() => onMemberMenu(m)} />
        ))}
      </Section>
      {away.length ? (
        <Section title="Away">
          {away.map((m) => (
            <MemberRowItem key={m.user_id} member={m} speaking={false} onMenu={() => onMemberMenu(m)} />
          ))}
        </Section>
      ) : null}
      {isHost && removed.length ? (
        <Section title="Removed">
          {removed.map((m) => (
            <MemberRowItem key={m.user_id} member={m} speaking={false} onMenu={() => onMemberMenu(m)} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="slate mb-1 px-1">{title}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function MemberRowItem({ member, speaking, onMenu }: { member: MemberView; speaking: boolean; onMenu: () => void }) {
  const controller = useController();
  const me = member.user_id === controller.userId;
  const presence = member.presence;
  const voice = member.voice_muted ? 'muted_by_host' : presence?.voice ?? 'off';
  return (
    <li className="flex min-h-14 items-center gap-3 rounded-lg px-1" data-testid="member" data-user={member.user_id}>
      <Avatar name={member.name} src={member.avatar_url} size={40} speaking={speaking} dimmed={!member.present} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-semibold">{me ? `${member.name} (you)` : member.name}</span>
          {member.role === 'host' ? (
            <Badge tone="amber">
              <Icon name="crown" size={12} />
              Host
            </Badge>
          ) : null}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {presence ? (
            <span className="inline-flex items-center gap-1">
              <Icon name={presence.device === 'phone' ? 'phone' : 'desktop'} size={14} />
              {presence.device === 'phone' ? 'Phone' : 'Computer'}
            </span>
          ) : null}
          <span>{member.sync_mode === 'auto' ? 'Auto sync' : 'Guided sync'}</span>
          {voice === 'muted_by_host' ? (
            <span className="inline-flex items-center gap-1 text-red">
              <Icon name="micOff" size={14} />
              Muted by host
            </span>
          ) : voice === 'live' ? (
            <span className="inline-flex items-center gap-1 text-green">
              <Icon name="mic" size={14} />
              In voice
            </span>
          ) : voice === 'muted' ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="micOff" size={14} />
              Mic off
            </span>
          ) : null}
          {member.state === 'removed' ? <span className="text-red">Removed</span> : null}
          {member.buffering_since && member.present ? <span className="text-amber">Buffering</span> : null}
        </p>
      </div>
      {me ? null : <IconButton icon="more" label={`Options for ${member.name}`} onClick={onMenu} />}
    </li>
  );
}

/** Present members as a row of seats: speaking rings, host mute marks, camera bubbles, empty seats. */
export function MemberStrip({
  speaking,
  cameras,
  attachVideo,
  className,
}: {
  speaking: Set<string>;
  /** Members whose camera is on. */
  cameras: Set<string>;
  attachVideo: (userId: string, el: HTMLMediaElement) => () => void;
  className?: string;
}) {
  const controller = useController();
  const { members, room } = useRoom(controller);
  const here = members.filter((m) => m.state === 'joined' && m.present);
  const empty = Math.max(0, (room?.room_cap ?? 0) - here.length);
  return (
    <div className={cx('flex items-center gap-3 overflow-x-auto px-3 py-2 no-scrollbar', className)} aria-label="People here" role="list">
      {here.map((m) => (
        <div
          key={m.user_id}
          role="listitem"
          className="flex w-14 shrink-0 flex-col items-center gap-1"
          data-testid="seat"
          data-user={m.user_id}
          data-speaking={speaking.has(m.user_id) ? 'true' : 'false'}
        >
          <span className="relative">
            {cameras.has(m.user_id) ? (
              <VideoBubble userId={m.user_id} attach={attachVideo} speaking={speaking.has(m.user_id)} label={m.name} />
            ) : (
              <Avatar name={m.name} src={m.avatar_url} size={44} speaking={speaking.has(m.user_id)} />
            )}
            {m.voice_muted || m.presence?.voice === 'muted' ? (
              <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-surface-3 text-red ring-2 ring-ink">
                <Icon name="micOff" size={12} title={m.voice_muted ? 'Muted by host' : 'Mic off'} />
              </span>
            ) : null}
            {m.role === 'host' ? (
              <span className="absolute -left-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-amber text-amber-ink ring-2 ring-ink">
                <Icon name="crown" size={11} title="Host" />
              </span>
            ) : null}
          </span>
          <span className="w-full truncate text-center text-xs text-muted">
            {m.user_id === controller.userId ? 'You' : m.name.split(' ')[0]}
          </span>
        </div>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <div key={`empty-${i}`} role="listitem" className="flex w-14 shrink-0 flex-col items-center gap-1" aria-label="Empty seat">
          <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-line-strong text-line-strong">
            <Icon name="seat" size={20} />
          </span>
          <span className="text-xs text-faint">Free</span>
        </div>
      ))}
    </div>
  );
}

function VideoBubble({
  userId,
  attach,
  speaking,
  label,
}: {
  userId: string;
  attach: (userId: string, el: HTMLMediaElement) => () => void;
  speaking: boolean;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attach(userId, el);
  }, [attach, userId]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      aria-label={`${label}'s camera`}
      className={cx('size-11 rounded-full bg-surface-3 object-cover ring-2', speaking ? 'ring-green' : 'ring-transparent')}
    />
  );
}

/** Plays every other member's voice. Hidden: the speaking rings and mute marks are the visible part. */
export function VoiceAudio({ userIds, attach }: { userIds: string[]; attach: (userId: string, el: HTMLMediaElement) => () => void }) {
  return (
    <div className="hidden" aria-hidden="true">
      {userIds.map((id) => (
        <RemoteAudio key={id} userId={id} attach={attach} />
      ))}
    </div>
  );
}

function RemoteAudio({ userId, attach }: { userId: string; attach: (userId: string, el: HTMLMediaElement) => () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attach(userId, el);
  }, [attach, userId]);
  return <audio ref={ref} autoPlay playsInline />;
}
