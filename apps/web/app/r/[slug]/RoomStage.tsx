'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { isPaidSource, SOURCE_LABEL, type MessageRow } from '@watchparty/sync-core';
import { cx, Icon, IconButton, Sheet, Button, useToast } from '@watchparty/ui';
import {
  ChatComposer,
  ChatList,
  CueControls,
  CueScreen,
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
  useController as useRoomController,
} from '@watchparty/ui/room';
import { errorSentence, voiceErrorSentence } from '@/lib/errors';
import { isIOS } from '@/lib/adapters/youtube';
import { DESKTOP_QUERY, PHONE_LANDSCAPE_QUERY, useMediaQuery } from '@/lib/use-media';
import { seenOnce } from '@/lib/once';
import { ExtensionSlot, HandedOver } from './Handover';
import { Player } from './Player';
import type { RoomMe } from './RoomEntry';

type Tab = 'chat' | 'people' | 'sync';

export function RoomStage({ controller, me, onRejoin }: { controller: RoomController; me: RoomMe; onRejoin: () => void }) {
  const state = useRoom(controller);
  const toast = useToast();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const landscape = useMediaQuery(PHONE_LANDSCAPE_QUERY);
  const voice = useRoomVoice(controller);
  const [duckLevel, setDuckLevel] = useState<number | null>(me.duckLevel);
  useDucking(controller, voice, duckLevel);
  // Stable callbacks: a new function each render would detach and re-attach every member's media.
  const voiceAttach = voice.attach;
  const attachAudio = useCallback((id: string, el: HTMLMediaElement) => voiceAttach(id, 'audio', el), [voiceAttach]);
  const attachVideo = useCallback((id: string, el: HTMLMediaElement) => voiceAttach(id, 'video', el), [voiceAttach]);

  const [tab, setTab] = useState<Tab>('chat');
  const [sheet, setSheet] = useState<'host' | 'mine' | 'voice' | 'chat' | null>(null);
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
  const hostMuted = voice.local.hostMuted;
  useEffect(() => {
    if (hostMuted) toast('The host muted you.', 'info');
  }, [hostMuted, toast]);

  const room = state.room;
  const timed = useMemo(() => state.messages.filter((m) => m.kind === 'timed'), [state.messages]);
  const othersInVoice = state.presence.filter((p) => p.user_id !== me.id && p.voice !== 'off').map((p) => p.user_id);
  if (!room) return null;

  if (state.fatal === 'handed_over') return <HandedOver controller={controller} room={room} onReturned={onRejoin} />;

  const youtube = room.source === 'youtube';
  const isHost = room.host_id === me.id;
  const nameOf = (id: string | null) => controller.nameOf(id);
  const duration = controller.engineHost?.getDuration() ?? null;
  const duckingReason = !youtube
    ? 'The film plays outside this page, so its volume cannot be changed from here.'
    : isIOS()
      ? 'iPhone and iPad do not let web pages change YouTube volume.'
      : 'The player has not loaded yet.';
  const duckingAvailable = Boolean(controller.engineHost?.capabilities.volume);

  const band = (
    <ReactionBand reactions={state.reactions} popups={state.popups} timed={timed} duration={duration} nameOf={nameOf} />
  );
  const overlayBand = (
    <ReactionBand
      reactions={state.reactions}
      popups={state.popups}
      timed={[]}
      duration={null}
      nameOf={nameOf}
      transparent
      className="!absolute inset-x-0 bottom-0"
    />
  );
  const extensionSlot = isPaidSource(room.source) && desktop ? <ExtensionSlot controller={controller} room={room} voice={voice} /> : null;

  const chat = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatList onMessageMenu={setMessageMenu} />
      <ChatComposer />
    </div>
  );
  const people = <PeopleList onMemberMenu={setMemberMenu} speaking={voice.speaking} />;
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'chat', label: 'Chat' },
    { id: 'people', label: `People · ${state.members.filter((m) => m.state === 'joined' && m.present).length}` },
    ...(!youtube && !desktop ? [{ id: 'sync' as Tab, label: 'Sync' }] : []),
  ];

  const controls = (
    <RoomControls
      voice={voice}
      trayOpen={trayOpen}
      onTray={() => setTrayOpen((o) => !o)}
      onJoinVoice={() => setSheet('voice')}
      onLeave={async () => {
        await voice.leave();
        await controller.leave();
      }}
    />
  );

  const sheets = (
    <>
      {isHost ? <HostSheet open={sheet === 'host'} onClose={() => setSheet(null)} /> : null}
      <MySettingsSheet
        open={sheet === 'mine'}
        onClose={() => setSheet(null)}
        duckLevel={duckLevel}
        onDuckLevel={setDuckLevel}
        duckingAvailable={duckingAvailable}
        duckingReason={duckingReason}
      />
      <VoiceSheet open={sheet === 'voice'} onClose={() => setSheet(null)} voice={voice} desktop={desktop} />
      <Sheet open={sheet === 'chat'} onClose={() => setSheet(null)} title="Chat">
        <div className="-mx-5 -my-4 flex h-[70dvh] flex-col">{chat}</div>
      </Sheet>
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
      <VoiceAudio userIds={othersInVoice} trackVersions={voice.trackVersions} attach={attachAudio} />
    </>
  );

  const topBar = (
    <header className="safe-top flex min-h-14 shrink-0 items-center gap-2 border-b border-line bg-ink px-2 lg:col-span-2 lg:px-4">
      <Link href="/home" aria-label="Your rooms" className="inline-flex size-11 items-center justify-center rounded-lg hover:bg-surface-3">
        <Icon name="chevronLeft" size={22} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold leading-tight" data-testid="room-title">
          {room.title}
        </h1>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          {room.visibility === 'private' ? <Icon name="lock" size={12} /> : null}
          {SOURCE_LABEL[room.source]}
          {room.locked ? ' · Locked' : ''}
          {state.status === 'reconnecting' ? ' · Reconnecting' : ''}
        </p>
      </div>
      <IconButton icon="volume" label="My settings" onClick={() => setSheet('mine')} />
      {isHost ? <IconButton icon="sliders" label="Room settings" onClick={() => setSheet('host')} data-testid="room-settings" /> : null}
    </header>
  );

  // Phones held sideways: the film fills the height; a narrow column keeps reactions and the latest chat.
  if (landscape && !desktop) {
    return (
      <RoomProvider controller={controller}>
        <div className="grid h-dvh grid-cols-[minmax(0,1fr)_15rem] overflow-hidden bg-black">
          <div className="flex min-h-0 items-center justify-center">
            {youtube ? (
              <div className="h-full max-h-dvh w-full [&_[data-testid=player]]:!max-w-[calc(100dvh*16/9)]">
                <Player controller={controller} room={room} />
              </div>
            ) : (
              <div className="w-full">
                <CueScreen compact overlay={overlayBand} />
              </div>
            )}
          </div>
          <aside className="safe-bottom flex min-h-0 flex-col border-l border-line bg-ink">
            {youtube ? band : null}
            <SyncStatus />
            <RecentChat onOpen={() => setSheet('chat')} />
            <div className="flex items-center justify-around border-t border-line py-1">
              <MicButton voice={voice} onJoinVoice={() => setSheet('voice')} compact />
              <IconButton icon="smile" label="React" onClick={() => setTrayOpen((o) => !o)} tone={trayOpen ? 'active' : 'default'} />
              <IconButton icon="chat" label="Open chat" onClick={() => setSheet('chat')} />
            </div>
            {trayOpen ? (
              <div className="border-t border-line p-1 [&>div]:grid-cols-4">
                <ReactionTray onReact={(e) => controller.react(e)} />
              </div>
            ) : null}
          </aside>
        </div>
        {sheets}
      </RoomProvider>
    );
  }

  return (
    <RoomProvider controller={controller}>
      <div className="flex h-dvh flex-col overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_23.5rem] lg:grid-rows-[auto_minmax(0,1fr)]">
        {topBar}
        <main className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">
          {youtube ? (
            <>
              <Player controller={controller} room={room} />
              {band}
            </>
          ) : desktop ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
              <CueScreen overlay={overlayBand} />
              <CueControls extensionSlot={extensionSlot} />
            </div>
          ) : (
            <CueScreen compact overlay={overlayBand} />
          )}
          <SyncStatus />
          <MemberStrip
            speaking={voice.speaking}
            cameras={voice.cameras}
            trackVersions={voice.trackVersions}
            attachVideo={attachVideo}
            className="shrink-0"
          />
          {desktop ? (
            <div className="relative mx-auto mt-auto w-full max-w-3xl px-3 pb-4">
              {trayOpen ? (
                <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 animate-pop-in rounded-xl bg-surface-2 p-1.5 ring-1 ring-line">
                  <ReactionTray onReact={(e) => controller.react(e)} />
                </div>
              ) : null}
              {controls}
            </div>
          ) : (
            <>
              <TabBar tabs={tabs} value={tab} onChange={setTab} />
              <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
                {tab === 'chat' ? chat : tab === 'people' ? people : <div className="overflow-y-auto p-3"><CueControls extensionSlot={extensionSlot} /></div>}
              </div>
            </>
          )}
        </main>
        {desktop ? (
          <aside className="flex min-h-0 flex-col border-l border-line bg-ink">
            <TabBar tabs={tabs} value={tab === 'sync' ? 'chat' : tab} onChange={setTab} />
            <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
              {tab === 'people' ? people : chat}
            </div>
          </aside>
        ) : (
          <div className="safe-bottom relative shrink-0 border-t border-line bg-surface-1 px-2 pt-1.5">
            {trayOpen ? (
              <div className="absolute inset-x-2 bottom-full mb-2 animate-pop-in rounded-xl bg-surface-2 p-1.5 ring-1 ring-line">
                <ReactionTray onReact={(e) => controller.react(e)} />
              </div>
            ) : null}
            {controls}
          </div>
        )}
      </div>
      {sheets}
    </RoomProvider>
  );
}

function TabBar({ tabs, value, onChange }: { tabs: Array<{ id: Tab; label: string }>; value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div role="tablist" aria-label="Room panels" className="flex shrink-0 border-b border-line px-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'relative min-h-11 flex-1 px-3 text-sm font-semibold transition-colors',
            value === t.id ? 'text-text' : 'text-faint hover:text-muted',
          )}
        >
          {t.label}
          {value === t.id ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-amber" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

function MicButton({ voice, onJoinVoice, compact = false }: { voice: RoomVoice; onJoinVoice: () => void; compact?: boolean }) {
  const inVoice = voice.state !== 'idle';
  if (voice.state === 'failed') {
    return <IconButton icon="sync" label="Rejoin voice" showLabel={!compact} tone="danger" onClick={() => voice.join()} />;
  }
  if (!inVoice) return <IconButton icon="mic" label="Join voice" showLabel={!compact} onClick={onJoinVoice} data-testid="join-voice" />;
  if (voice.local.hostMuted) return <IconButton icon="micOff" label="The host muted you" showLabel={!compact} tone="muted" disabled />;
  return (
    <IconButton
      icon={voice.local.micEnabled ? 'mic' : 'micOff'}
      label={voice.local.micEnabled ? 'Mute' : 'Unmute'}
      showLabel={!compact}
      tone={voice.local.micEnabled ? 'active' : 'muted'}
      aria-pressed={voice.local.micEnabled}
      onClick={() => void voice.setMic(!voice.local.micEnabled)}
      data-testid="mic-toggle"
    />
  );
}

function RoomControls({
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
    <div
      className="flex items-center justify-around gap-1 lg:justify-center lg:gap-3"
      role="toolbar"
      aria-label="Room controls"
      data-voice-state={voice.state}
    >
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
      {inVoice ? (
        <IconButton icon="headphones" label="Leave voice" showLabel onClick={() => void voice.leave()} />
      ) : null}
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
        data-testid="leave-room"
      />
    </div>
  );
}

function VoiceSheet({ open, onClose, voice, desktop }: { open: boolean; onClose: () => void; voice: RoomVoice; desktop: boolean }) {
  const [tip, setTip] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (desktop && !seenOnce('headphones')) setTip("Use headphones so others don't hear the movie twice.");
    else if (isIOS() && !seenOnce('ios-lock')) setTip('Voice stops when your screen locks or you switch to another app.');
    else setTip(null);
  }, [open, desktop]);
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
            // join() prepares audio first, inside this tap, which iOS requires.
            voice.join();
            onClose();
          }}
          data-testid="confirm-join-voice"
        >
          Join voice
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-muted">Your browser will ask to use your microphone so the room can hear you. Your camera stays off until you turn it on.</p>
        {tip ? (
          <p className="flex items-start gap-2 rounded-lg bg-surface-1 px-3 py-2.5 text-sm">
            <Icon name="headphones" size={18} className="mt-0.5 shrink-0 text-amber" />
            {tip}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Landscape phones: the last three messages, each fading after five seconds. Tap to open chat. */
function RecentChat({ onOpen }: { onOpen: () => void }) {
  const controller = useRoomController();
  const { messages } = useRoom(controller);
  const recent = messages.filter((m) => m.kind !== 'system').slice(-3);
  return (
    <button type="button" onClick={onOpen} className="flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-hidden px-3 py-2 text-left" aria-label="Open chat">
      {recent.map((m) => (
        <p key={m.id} className="animate-[fade-out_5000ms_linear_forwards] truncate text-sm motion-reduce:animate-none">
          <span className="font-semibold">{controller.nameOf(m.user_id)}</span> <span className="text-muted">{m.body}</span>
        </p>
      ))}
    </button>
  );
}

