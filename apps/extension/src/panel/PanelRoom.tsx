import { useEffect, useMemo, useState } from 'react';
import { SOURCE_LABEL, type MessageRow } from '@watchparty/sync-core';
import { Button, cx, Icon, IconButton, Notice, Sheet, useToast } from '@watchparty/ui';
import {
  ChatComposer,
  ChatList,
  HostSheet,
  MemberMenu,
  MemberStrip,
  MessageMenu,
  MySettingsSheet,
  PeopleList,
  ReactionBand,
  ReactionTray,
  ReportSheet,
  RoomProvider,
  SyncStatus,
  useDucking,
  useRoom,
  useRoomVoice,
  VoiceAudio,
  type MemberView,
  type RoomController,
  type RoomVoice,
} from '@watchparty/ui/room';
import { errorSentence, voiceErrorSentence } from './errors';
import type { PanelMe, PanelSession, PanelState } from './session';

// The room in a narrow panel docked on the right of the streaming tab: the same components as the
// room page's side column, with the film playing in the tab itself.

type Tab = 'chat' | 'people';

export function PanelRoom({
  session,
  state,
  controller,
  me,
}: {
  session: PanelSession;
  state: PanelState;
  controller: RoomController;
  me: PanelMe;
}) {
  const room = useRoom(controller);
  const toast = useToast();
  const voice = useRoomVoice(controller);
  const [duckLevel, setDuckLevel] = useState<number | null>(me.duckLevel);
  useDucking(controller, voice, duckLevel);

  const [tab, setTab] = useState<Tab>('chat');
  const [sheet, setSheet] = useState<'host' | 'mine' | 'voice' | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [memberMenu, setMemberMenu] = useState<MemberView | null>(null);
  const [messageMenu, setMessageMenu] = useState<MessageRow | null>(null);
  const [report, setReport] = useState<{ userId: string; messageId: string | null } | null>(null);

  useEffect(
    () =>
      controller.onNotice((notice) => {
        if (notice.code) toast(errorSentence(notice.code, { roomCap: controller.store.get().room?.room_cap }), notice.tone);
        else if (notice.message) toast(notice.message, notice.tone);
      }),
    [controller, toast],
  );
  useEffect(() => {
    if (voice.error) toast(voiceErrorSentence(voice.error), 'error');
  }, [voice.error, toast]);

  // A stop from the worker leaves voice before the session goes back to the room page.
  useEffect(() => {
    session.setVoiceLeave(() => voice.leave());
    return () => session.setVoiceLeave(null);
  }, [session, voice]);

  // The floating control in full screen shows the microphone state and can mute or unmute.
  const indicator = voice.state === 'idle' || voice.state === 'failed' ? 'off' : voice.local.hostMuted ? 'host_muted' : voice.local.micEnabled ? 'live' : 'muted';
  useEffect(() => session.setVoiceIndicator(indicator), [session, indicator]);
  useEffect(
    () =>
      session.onFullscreenMic(() => {
        if (indicator === 'live' || indicator === 'muted') void voice.setMic(indicator !== 'live');
      }),
    [session, voice, indicator],
  );

  const timed = useMemo(() => room.messages.filter((m) => m.kind === 'timed'), [room.messages]);
  const othersInVoice = room.presence.filter((p) => p.user_id !== me.id && p.voice !== 'off').map((p) => p.user_id);
  const current = room.room;
  if (!current) return null;
  const isHost = current.host_id === me.id;
  const service = SOURCE_LABEL[current.source];
  const nameOf = (id: string | null) => controller.nameOf(id);
  const duckingAvailable = Boolean(controller.engineHost?.capabilities.volume);
  const here = room.members.filter((m) => m.state === 'joined' && m.present).length;

  const band = (
    <ReactionBand
      reactions={room.reactions}
      popups={room.popups}
      timed={timed}
      duration={null}
      nameOf={nameOf}
      transparent
      className="!absolute inset-x-0 bottom-0"
    />
  );

  return (
    <RoomProvider controller={controller}>
      <div className="flex h-dvh flex-col overflow-hidden bg-ink">
        <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2">
          <div className="min-w-0 flex-1 pl-1">
            <h1 className="truncate text-base font-bold leading-tight" data-testid="room-title">
              {current.title}
            </h1>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              {current.visibility === 'private' ? <Icon name="lock" size={12} /> : null}
              {service}
              {current.locked ? ' · Locked' : ''}
              {room.status === 'reconnecting' ? ' · Reconnecting' : ''}
            </p>
          </div>
          <IconButton icon="volume" label="My settings" onClick={() => setSheet('mine')} />
          {isHost ? <IconButton icon="sliders" label="Room settings" onClick={() => setSheet('host')} /> : null}
          <IconButton icon="chevronRight" label="Hide the room panel" onClick={() => session.collapse()} />
        </header>

        <EpisodeNotice session={session} state={state} service={service} />
        {room.status === 'live' && (!state.peer || !state.video) ? (
          <p className="flex min-h-10 items-center gap-2 px-3 text-sm text-muted" role="status">
            <Icon name="info" size={16} className="shrink-0 text-amber" />
            {state.peer ? `Waiting for the ${service} player in this tab.` : 'Reconnecting to the player in this tab.'}
          </p>
        ) : null}
        <SyncStatus />
        <MemberStrip
          speaking={voice.speaking}
          cameras={voice.cameras}
          attachVideo={(id, el) => voice.attach(id, 'video', el)}
          className="shrink-0 border-b border-line"
        />

        <div role="tablist" aria-label="Room panels" className="flex shrink-0 border-b border-line px-2">
          {(
            [
              { id: 'chat', label: 'Chat' },
              { id: 'people', label: `People · ${here}` },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'relative min-h-11 flex-1 px-3 text-sm font-semibold transition-colors',
                tab === t.id ? 'text-text' : 'text-faint hover:text-muted',
              )}
            >
              {t.label}
              {tab === t.id ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-amber" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" aria-label={tab === 'chat' ? 'Chat' : 'People'}>
          <div className="relative flex min-h-0 flex-1 flex-col">
            {tab === 'chat' ? <ChatList onMessageMenu={setMessageMenu} /> : <PeopleList onMemberMenu={setMemberMenu} speaking={voice.speaking} />}
            {band}
          </div>
          {tab === 'chat' ? <ChatComposer /> : null}
        </div>

        <div className="relative shrink-0 border-t border-line bg-surface-1 px-1 py-1.5">
          {trayOpen ? (
            <div className="absolute inset-x-1 bottom-full mb-2 animate-pop-in rounded-xl bg-surface-2 p-1 ring-1 ring-line [&>div]:grid-cols-4 [&>div]:justify-items-center">
              <ReactionTray onReact={(e) => session.react(e)} />
            </div>
          ) : null}
          <Controls
            voice={voice}
            trayOpen={trayOpen}
            onTray={() => setTrayOpen((o) => !o)}
            onJoinVoice={() => setSheet('voice')}
            onLeave={async () => {
              await voice.leave();
              await controller.leave();
            }}
          />
        </div>
      </div>

      {isHost ? <HostSheet open={sheet === 'host'} onClose={() => setSheet(null)} /> : null}
      <MySettingsSheet
        open={sheet === 'mine'}
        onClose={() => setSheet(null)}
        duckLevel={duckLevel}
        onDuckLevel={setDuckLevel}
        duckingAvailable={duckingAvailable}
        duckingReason={`The ${service} player in this tab does not let the extension change its volume.`}
      />
      <VoiceSheet open={sheet === 'voice'} onClose={() => setSheet(null)} voice={voice} />
      <MemberMenu
        member={memberMenu}
        onClose={() => setMemberMenu(null)}
        onReport={(m) => {
          setMemberMenu(null);
          setReport({ userId: m.user_id, messageId: null });
        }}
      />
      <MessageMenu
        message={messageMenu}
        onClose={() => setMessageMenu(null)}
        onReport={(m) => {
          setMessageMenu(null);
          if (m.user_id) setReport({ userId: m.user_id, messageId: m.id });
        }}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      <VoiceAudio userIds={othersInVoice} attach={(id, el) => voice.attach(id, 'audio', el)} />
    </RoomProvider>
  );
}

function EpisodeNotice({ session, state, service }: { session: PanelSession; state: PanelState; service: string }) {
  const [busy, setBusy] = useState(false);
  if (state.episode === 'match') return null;
  if (state.episode === 'guest_elsewhere') {
    return (
      <div className="shrink-0 px-2 pt-2" data-testid="episode-notice">
        <Notice
          title="You're on a different episode than the host"
          action={
            <Button variant="primary" icon="play" onClick={() => session.openRoomTitle()}>
              Go to the host&rsquo;s episode
            </Button>
          }
        >
          Sync is paused in this tab until you are back on the same title.
        </Notice>
      </div>
    );
  }
  return (
    <div className="shrink-0 px-2 pt-2" data-testid="episode-notice">
      <Notice
        title="This tab is on a different title than the room"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                await session.playThisTitleForEveryone();
                setBusy(false);
              }}
            >
              Play this for everyone
            </Button>
            <Button variant="ghost" onClick={() => session.openRoomTitle()}>
              Go back
            </Button>
          </div>
        }
      >
        Everyone else is still on the room&rsquo;s title in {service}.
      </Notice>
    </div>
  );
}

function MicButton({ voice, onJoinVoice }: { voice: RoomVoice; onJoinVoice: () => void }) {
  if (voice.state === 'failed') {
    return <IconButton icon="sync" label="Rejoin voice" showLabel tone="danger" onClick={() => voice.join()} />;
  }
  if (voice.state === 'idle') return <IconButton icon="mic" label="Join voice" showLabel onClick={onJoinVoice} />;
  if (voice.local.hostMuted) return <IconButton icon="micOff" label="Muted by host" showLabel tone="muted" disabled />;
  return (
    <IconButton
      icon={voice.local.micEnabled ? 'mic' : 'micOff'}
      label={voice.local.micEnabled ? 'Mute' : 'Unmute'}
      showLabel
      tone={voice.local.micEnabled ? 'active' : 'muted'}
      aria-pressed={voice.local.micEnabled}
      onClick={() => void voice.setMic(!voice.local.micEnabled)}
    />
  );
}

function Controls({
  voice,
  trayOpen,
  onTray,
  onJoinVoice,
  onLeave,
}: {
  voice: RoomVoice;
  trayOpen: boolean;
  onTray: () => void;
  onJoinVoice: () => void;
  onLeave: () => Promise<void>;
}) {
  const inVoice = voice.state !== 'idle' && voice.state !== 'failed';
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="flex items-center justify-around" role="toolbar" aria-label="Room controls" data-voice-state={voice.state}>
      <MicButton voice={voice} onJoinVoice={onJoinVoice} />
      <IconButton
        icon={voice.local.cameraEnabled ? 'camera' : 'cameraOff'}
        label={voice.local.cameraEnabled ? 'Camera on' : 'Camera off'}
        showLabel
        tone={voice.local.cameraEnabled ? 'active' : 'default'}
        aria-pressed={voice.local.cameraEnabled}
        disabled={!inVoice || voice.local.hostMuted}
        onClick={() => void voice.setCamera(!voice.local.cameraEnabled)}
      />
      {inVoice ? <IconButton icon="headphones" label="Leave voice" showLabel onClick={() => void voice.leave()} /> : null}
      <IconButton icon="smile" label="React" showLabel tone={trayOpen ? 'active' : 'default'} aria-expanded={trayOpen} onClick={onTray} />
      <IconButton
        icon="leave"
        label={leaving ? 'Leaving' : 'Leave'}
        showLabel
        tone="danger"
        disabled={leaving}
        onClick={async () => {
          setLeaving(true);
          await onLeave();
        }}
      />
    </div>
  );
}

const HEADPHONES_TIP_KEY = 'watchparty:tip:headphones';

/** Shows the headphones tip the first time only. */
function headphonesTipOnce(): boolean {
  try {
    if (localStorage.getItem(HEADPHONES_TIP_KEY)) return false;
    localStorage.setItem(HEADPHONES_TIP_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

function VoiceSheet({ open, onClose, voice }: { open: boolean; onClose: () => void; voice: RoomVoice }) {
  const [tip, setTip] = useState(false);
  useEffect(() => {
    if (open) setTip(headphonesTipOnce());
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Talk while you watch"
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          icon="mic"
          onClick={() => {
            // join() prepares audio first, inside this tap, as browsers require.
            voice.join();
            onClose();
          }}
        >
          Join voice
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-muted">
          Your browser will ask to use your microphone so the room can hear you. Your camera stays off until you turn it on.
        </p>
        {tip ? (
          <p className="flex items-start gap-2 rounded-lg bg-surface-1 px-3 py-2.5 text-sm">
            <Icon name="headphones" size={18} className="mt-0.5 shrink-0 text-amber" />
            Use headphones so others don&rsquo;t hear the movie twice.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
