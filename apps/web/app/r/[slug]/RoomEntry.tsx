'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deviceKind, isPaidSource, type ErrorCode, type RoomPreview, type Source } from '@watchparty/sync-core';
import { RoomController, useRoom, type Me } from '@watchparty/ui/room';
import { Wordmark } from '@/components/Wordmark';
import { getBrowserClient } from '@/lib/supabase/client';
import { workerTicker } from '@/lib/ticker';
import { FUNCTIONS_URL } from '@/lib/env';
import { captureJoinKey, readJoinKey } from './key';
import { FatalScreen, JoinScreen, SignedOutGate } from './JoinScreen';
import { RoomStage } from './RoomStage';

export interface RoomMe extends Me {
  duckLevel: number | null;
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'preview'; preview: RoomPreview | null; error: ErrorCode | null; roomCap?: number }
  | { kind: 'room'; controller: RoomController };

function syncModeFor(source: Source): 'auto' | 'cue' {
  // The room page drives only YouTube. Paid sources start on cue sync; the sync extension switches
  // the member to auto sync after a handover.
  return isPaidSource(source) ? 'cue' : 'auto';
}

export function RoomEntry({ slug, me }: { slug: string; me: RoomMe | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [joining, setJoining] = useState(false);
  const controllerRef = useRef<RoomController | null>(null);

  useLayoutEffect(() => {
    captureJoinKey(slug);
    // A link pasted into a room page that is already open only changes the fragment; treat it as a
    // fresh visit so a new key is used even after the room ended or refused this member.
    const onHash = () => {
      const hadKey = /(^|[#&])k=/.test(window.location.hash);
      captureJoinKey(slug);
      if (hadKey) window.location.reload();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [slug]);

  const join = useCallback(
    async (source: Source | null) => {
      if (!me) return;
      setJoining(true);
      const supabase = getBrowserClient();
      const controller = new RoomController({
        supabase,
        me,
        device: deviceKind(window.matchMedia?.bind(window)),
        engine: 'page',
        createTicker: workerTicker,
        functionsUrl: FUNCTIONS_URL || undefined,
        log: (event, detail) => console.warn(`[room] ${event}`, detail),
      });
      const res = await controller.join(slug, readJoinKey(slug), syncModeFor(source ?? 'youtube'));
      setJoining(false);
      if (!res.ok) {
        await controller.destroy();
        const roomCap = (res.data as { room_cap?: number } | undefined)?.room_cap;
        const preview = await controller.api.roomPreview(slug);
        setPhase({ kind: 'preview', preview: preview.ok ? preview.data : null, error: res.code, roomCap });
        return;
      }
      // A paid source room joined as cue sync; correct the mode if the source was not known yet.
      const joinedSource = res.data.room.source;
      if (syncModeFor(joinedSource) !== syncModeFor(source ?? 'youtube')) controller.setSyncMode(syncModeFor(joinedSource));
      controllerRef.current = controller;
      setPhase({ kind: 'room', controller });
    },
    [me, slug],
  );

  // Members go straight in; everyone else sees the join screen from room_preview.
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      const supabase = getBrowserClient();
      const { data: room } = await supabase.from('room_view').select('id, source, status').eq('slug', slug).maybeSingle();
      if (cancelled) return;
      if (room && room.status === 'open') {
        await join(room.source as Source);
        return;
      }
      const preview = await new RoomController({ supabase, me, device: 'desktop', engine: 'page' }).api.roomPreview(slug);
      if (cancelled) return;
      setPhase({
        kind: 'preview',
        preview: preview.ok ? preview.data : null,
        error: preview.ok ? (preview.data.status === 'closed' ? 'closed' : null) : preview.code,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [me, slug, join]);

  useEffect(() => () => void controllerRef.current?.destroy(), []);

  if (!me) return <SignedOutGate slug={slug} />;

  if (phase.kind === 'checking') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4" aria-busy="true">
        <Wordmark />
        <p className="text-muted">Finding the room…</p>
      </div>
    );
  }

  if (phase.kind === 'preview') {
    return (
      <JoinScreen
        preview={phase.preview}
        error={phase.error}
        roomCap={phase.roomCap ?? phase.preview?.room_cap}
        busy={joining}
        onJoin={() => void join(phase.preview?.source ?? null)}
      />
    );
  }

  return (
    <RoomLive
      key={phase.controller.store.get().room?.id}
      controller={phase.controller}
      me={me}
      onRejoin={() => {
        void phase.controller.destroy();
        setPhase({ kind: 'checking' });
        void join(phase.controller.store.get().room?.source ?? null);
      }}
      onNotMember={() => {
        void phase.controller.destroy();
        setPhase({ kind: 'preview', preview: null, error: 'not_member' });
        router.refresh();
      }}
      onLeft={() => router.push('/home')}
    />
  );
}

function RoomLive({
  controller,
  me,
  onRejoin,
  onNotMember,
  onLeft,
}: {
  controller: RoomController;
  me: RoomMe;
  onRejoin: () => void;
  onNotMember: () => void;
  onLeft: () => void;
}) {
  const state = useRoom(controller);
  useEffect(() => {
    if (state.fatal === 'left') onLeft();
    if (state.fatal === 'not_member') onNotMember();
  }, [state.fatal, onLeft, onNotMember]);

  if (state.fatal && state.fatal !== 'left' && state.fatal !== 'not_member' && state.fatal !== 'handed_over') {
    return <FatalScreen kind={state.fatal} roomCap={state.room?.room_cap} onRejoin={onRejoin} />;
  }
  return <RoomStage controller={controller} me={me} onRejoin={onRejoin} />;
}
