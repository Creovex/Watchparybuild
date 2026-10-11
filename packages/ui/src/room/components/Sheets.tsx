'use client';

import { useEffect, useState } from 'react';
import {
  parseContentRef,
  REPORT_REASONS,
  SOURCE_LABEL,
  SOURCES,
  type MessageRow,
  type ReportReason,
  type Source,
} from '@watchparty/sync-core';
import { Icon, type IconName } from '../../icons';
import { Button, ChoiceGroup, cx, Notice, Sheet, Switch, TextArea, TextField, useCopy, useToast } from '../../primitives';
import type { MemberView } from '../controller';
import { useRoom } from '../hooks';
import { useController } from './context';

// Host settings ------------------------------------------------------------------------------------

export function HostSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const controller = useController();
  const { room, members } = useRoom(controller);
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [copy, copied] = useCopy();
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmRotate(false);
      setConfirmClose(false);
      return;
    }
    void controller.roomLink().then(setLink);
  }, [open, controller]);

  if (!room) return null;
  const guestsHere = members.filter((m) => m.state === 'joined' && m.present && m.user_id !== controller.userId);

  async function run(key: string, action: () => Promise<boolean>, done?: string) {
    setBusy(key);
    const ok = await action();
    setBusy(null);
    if (ok && done) toast(done, 'success');
    return ok;
  }

  return (
    <Sheet open={open} onClose={onClose} title="Room settings">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="slate">Room link</h3>
          <p className="break-all rounded-lg bg-surface-1 px-3 py-2 font-mono text-xs text-muted" data-testid="host-room-link">
            {link ?? 'Loading link…'}
          </p>
          {room.visibility === 'private' ? (
            <p className="text-sm text-muted">This link includes the room&rsquo;s key. Anyone with it can join.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button icon={copied ? 'check' : 'copy'} disabled={!link} onClick={() => link && void copy(link)}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {typeof navigator !== 'undefined' && 'share' in navigator ? (
              <Button
                icon="share"
                disabled={!link}
                onClick={() => link && void navigator.share({ title: room.title, url: link }).catch(() => undefined)}
              >
                Share
              </Button>
            ) : null}
          </div>
          {room.visibility === 'private' ? (
            <div className="mt-1">
              {confirmRotate ? (
                <Notice
                  title="Make a new link?"
                  action={
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        busy={busy === 'rotate'}
                        onClick={async () => {
                          const ok = await run('rotate', () => controller.rotateKey(), 'New link ready. The old one no longer works.');
                          if (ok) setLink(await controller.roomLink());
                          setConfirmRotate(false);
                        }}
                      >
                        Make new link
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
                        Keep this one
                      </Button>
                    </div>
                  }
                >
                  The old link stops working for anyone who hasn&rsquo;t joined yet. People already here stay.
                </Notice>
              ) : (
                <Button variant="ghost" icon="refresh" onClick={() => setConfirmRotate(true)}>
                  Make a new link
                </Button>
              )}
            </div>
          ) : null}
        </section>

        <ChoiceGroup
          legend="Who controls playback"
          name="control-mode"
          value={room.control_mode}
          onChange={(value) => void run('control', () => controller.updateSettings({ control_mode: value }))}
          options={[
            { value: 'host', label: 'Only the host', description: 'Guests who pause or seek snap back.', icon: 'crown' },
            { value: 'everyone', label: 'Everyone', description: 'Anyone can play, pause and seek.', icon: 'people' },
          ]}
        />

        <div className="flex flex-col divide-y divide-line">
          <Switch
            label="Wait for everyone"
            description="Pause the room while someone's stream catches up."
            checked={room.wait_for_everyone}
            onChange={(value) => void run('wait', () => controller.updateSettings({ wait_for_everyone: value }))}
          />
          <Switch
            label="Lock the room"
            description="Only people who were here before can come back in."
            checked={room.locked}
            onChange={(value) => void run('lock', () => controller.updateSettings({ locked: value }))}
          />
        </div>

        <SourcePicker />

        <section className="flex flex-col gap-2">
          <h3 className="slate">Hand over host</h3>
          {guestsHere.length ? (
            <ul className="flex flex-col gap-2">
              {guestsHere.map((m) => (
                <li key={m.user_id}>
                  <Button
                    block
                    icon="crown"
                    busy={busy === `host-${m.user_id}`}
                    onClick={() =>
                      void run(`host-${m.user_id}`, () => controller.transferHost(m.user_id), `${m.name} is now the host.`).then(
                        (ok) => ok && onClose(),
                      )
                    }
                  >
                    Make {m.name} host
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nobody else is here right now.</p>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-line pt-5">
          {confirmClose ? (
            <Notice
              tone="error"
              title="Close the room for everyone?"
              action={
                <div className="flex gap-2">
                  <Button variant="danger" busy={busy === 'close'} onClick={() => void run('close', () => controller.closeRoom())}>
                    Close room
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmClose(false)}>
                    Keep it open
                  </Button>
                </div>
              }
            >
              Everyone sees &ldquo;This room was closed&rdquo; and the link stops working.
            </Notice>
          ) : (
            <Button variant="ghost" icon="close" className="self-start text-red" onClick={() => setConfirmClose(true)}>
              Close room
            </Button>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/** The host's "what's playing" picker, also offered when YouTube refuses to embed a video. */
export function SourcePicker({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const controller = useController();
  const { room } = useRoom(controller);
  const [source, setSource] = useState<Source>(room?.source ?? 'youtube');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!room) return null;

  async function submit() {
    const parsed = parseContentRef(source, value);
    if (!parsed.ok) {
      setError(
        parsed.reason === 'live_stream'
          ? "Live streams can't be synced."
          : source === 'youtube'
            ? "That doesn't look like a YouTube video link."
            : 'Paste the address of the title from the service, starting with https://',
      );
      return;
    }
    setError(null);
    setBusy(true);
    const ok = await controller.setSource(source, parsed.ref);
    setBusy(false);
    if (ok) {
      setValue('');
      toast('Changed what everyone is watching. Playback is paused at the start.', 'success');
      onDone?.();
    }
  }

  return (
    <section className="flex flex-col gap-3">
      {compact ? null : <h3 className="slate">What&rsquo;s playing</h3>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Service">
        {SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={source === s}
            onClick={() => setSource(s)}
            className={cx(
              'min-h-11 rounded-lg px-2 text-sm font-semibold ring-1 ring-inset',
              source === s ? 'bg-surface-3 text-amber ring-amber' : 'bg-surface-1 text-muted ring-line hover:text-text',
            )}
          >
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          label={source === 'youtube' ? 'YouTube video link' : `${SOURCE_LABEL[source]} title address`}
          placeholder={source === 'youtube' ? 'https://www.youtube.com/watch?v=…' : 'https://'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          inputMode="url"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" busy={busy} disabled={!value.trim()} className="self-start">
          Play this for everyone
        </Button>
      </form>
    </section>
  );
}

// Member and message menus ---------------------------------------------------------------------------

interface MenuAction {
  icon: IconName;
  label: string;
  danger?: boolean;
  onSelect: () => void | Promise<unknown>;
}

function ActionList({ actions }: { actions: MenuAction[] }) {
  return (
    <ul className="flex flex-col">
      {actions.map((a) => (
        <li key={a.label}>
          <button
            type="button"
            onClick={() => void a.onSelect()}
            className={cx(
              'flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left font-semibold hover:bg-surface-3',
              a.danger ? 'text-red' : 'text-text',
            )}
          >
            <Icon name={a.icon} size={20} />
            {a.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MemberMenu({
  member,
  onClose,
  onReport,
}: {
  member: MemberView | null;
  onClose: () => void;
  onReport: (member: MemberView) => void;
}) {
  const controller = useController();
  const { room } = useRoom(controller);
  const toast = useToast();
  const [confirm, setConfirm] = useState<'remove' | 'ban' | null>(null);
  useEffect(() => setConfirm(null), [member]);
  if (!member || !room) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const isHost = room.host_id === controller.userId;
  const actions: MenuAction[] = [];

  if (isHost && member.state === 'removed') {
    actions.push({
      icon: 'userBack',
      label: 'Allow back in',
      onSelect: async () => {
        if (await controller.moderate(member.user_id, 'allow_back')) toast(`${member.name} can join again.`, 'success');
        onClose();
      },
    });
  }
  if (isHost && member.state === 'joined') {
    actions.push(
      member.voice_muted
        ? {
            icon: 'mic',
            label: 'Unmute voice',
            onSelect: async () => {
              await controller.moderate(member.user_id, 'unmute_voice');
              onClose();
            },
          }
        : {
            icon: 'micOff',
            label: 'Mute voice',
            onSelect: async () => {
              await controller.moderate(member.user_id, 'mute_voice');
              onClose();
            },
          },
    );
    if (member.present) {
      actions.push({
        icon: 'crown',
        label: 'Make host',
        onSelect: async () => {
          if (await controller.transferHost(member.user_id)) toast(`${member.name} is now the host.`, 'success');
          onClose();
        },
      });
    }
    actions.push(
      { icon: 'leave', label: 'Remove from room', danger: true, onSelect: () => setConfirm('remove') },
      { icon: 'ban', label: 'Ban from room', danger: true, onSelect: () => setConfirm('ban') },
    );
  }
  actions.push({ icon: 'flag', label: `Report ${member.name}`, onSelect: () => onReport(member) });

  return (
    <Sheet open={Boolean(member)} onClose={onClose} title={member.name}>
      {confirm ? (
        <Notice
          tone="error"
          title={confirm === 'ban' ? `Ban ${member.name}?` : `Remove ${member.name}?`}
          action={
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={async () => {
                  if (await controller.moderate(member.user_id, confirm)) {
                    toast(confirm === 'ban' ? `${member.name} is banned.` : `${member.name} was removed.`, 'success');
                  }
                  onClose();
                }}
              >
                {confirm === 'ban' ? 'Ban' : 'Remove'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          }
        >
          {confirm === 'ban'
            ? 'They leave now and can never join this room again.'
            : 'They leave now. You can let them back in from People.'}
        </Notice>
      ) : (
        <ActionList actions={actions} />
      )}
    </Sheet>
  );
}

export function MessageMenu({
  message,
  onClose,
  onReport,
}: {
  message: MessageRow | null;
  onClose: () => void;
  onReport: (message: MessageRow) => void;
}) {
  const controller = useController();
  const { room } = useRoom(controller);
  if (!message || !room) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const mine = message.user_id === controller.userId;
  const actions: MenuAction[] = [];
  if (mine || room.host_id === controller.userId) {
    actions.push({
      icon: 'trash',
      label: 'Delete message',
      danger: true,
      onSelect: async () => {
        await controller.deleteMessage(message.id);
        onClose();
      },
    });
  }
  if (!mine && message.user_id) {
    actions.push({ icon: 'flag', label: `Report ${controller.nameOf(message.user_id)}`, onSelect: () => onReport(message) });
  }
  if (!actions.length) actions.push({ icon: 'close', label: 'Nothing to do here', onSelect: onClose });
  return (
    <Sheet open={Boolean(message)} onClose={onClose} title="Message">
      <p className="mb-3 line-clamp-3 rounded-lg bg-surface-1 px-3 py-2 text-sm text-muted">{message.body}</p>
      <ActionList actions={actions} />
    </Sheet>
  );
}

const REASON_LABEL: Record<ReportReason, { label: string; description: string }> = {
  spam: { label: 'Spam', description: 'Flooding, adverts or links' },
  harassment: { label: 'Harassment', description: 'Abuse, threats or hate' },
  sexual: { label: 'Sexual content', description: 'Unwanted sexual messages' },
  other: { label: 'Something else', description: 'Tell us in the note' },
};

export function ReportSheet({
  target,
  onClose,
}: {
  target: { userId: string; messageId: string | null } | null;
  onClose: () => void;
}) {
  const controller = useController();
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason>('spam');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason('spam');
    setNote('');
  }, [target]);
  return (
    <Sheet
      open={Boolean(target)}
      onClose={onClose}
      title={target ? `Report ${controller.nameOf(target.userId)}` : 'Report'}
      footer={
        <Button
          variant="primary"
          block
          busy={busy}
          onClick={async () => {
            if (!target) return;
            setBusy(true);
            const ok = await controller.report({ targetUserId: target.userId, messageId: target.messageId, reason, note });
            setBusy(false);
            if (ok) {
              toast('Report sent. Thank you.', 'success');
              onClose();
            }
          }}
        >
          Send report
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup
          legend="What's wrong?"
          name="report-reason"
          value={reason}
          onChange={setReason}
          options={REPORT_REASONS.map((r) => ({ value: r, ...REASON_LABEL[r] }))}
        />
        <TextArea
          label="Note"
          optional
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint={`${note.length} of 500 characters`}
        />
        <p className="text-sm text-muted">Reports go to the people who run this app. The person you report is not told.</p>
      </div>
    </Sheet>
  );
}

// My settings --------------------------------------------------------------------------------------

export function MySettingsSheet({
  open,
  onClose,
  duckLevel,
  onDuckLevel,
  duckingAvailable,
  duckingReason,
}: {
  open: boolean;
  onClose: () => void;
  duckLevel: number | null;
  onDuckLevel: (level: number | null) => void;
  duckingAvailable: boolean;
  duckingReason: string;
}) {
  const controller = useController();
  const { syncMode, room } = useRoom(controller);
  const percent = Math.round((duckLevel ?? 0.35) * 100);
  return (
    <Sheet open={open} onClose={onClose} title="My settings">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="slate">Lower the movie while others talk</h3>
          {duckingAvailable ? (
            <>
              <Switch
                label="Ducking"
                description="Applies to this room until you leave. Your default is in Settings."
                checked={duckLevel !== null}
                onChange={(on) => onDuckLevel(on ? 0.35 : null)}
              />
              {duckLevel !== null ? (
                <label className="flex flex-col gap-2 text-sm font-semibold">
                  <span className="flex justify-between">
                    Movie volume while someone talks
                    <span className="timecode text-amber">{percent}%</span>
                  </span>
                  <input
                    type="range"
                    min={5}
                    max={90}
                    step={5}
                    value={percent}
                    onChange={(e) => onDuckLevel(Number(e.target.value) / 100)}
                    className="h-11 w-full accent-amber"
                  />
                </label>
              ) : null}
            </>
          ) : (
            <Notice>Ducking is not available here. {duckingReason}</Notice>
          )}
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="slate">Sync</h3>
          <p className="text-sm text-muted">
            {syncMode === 'auto'
              ? 'Auto sync: this device follows the room on its own.'
              : `Guided sync: ${room ? (room.source === 'youtube' ? 'YouTube' : 'this service') : 'the service'} plays outside this page, so start and pause it yourself when the room says.`}
          </p>
        </section>
      </div>
    </Sheet>
  );
}
