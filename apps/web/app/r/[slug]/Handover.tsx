'use client';

import { useEffect, useRef, useState } from 'react';
import { SOURCE_LABEL, type RoomRow } from '@watchparty/sync-core';
import { Button, Icon, useToast } from '@watchparty/ui';
import type { RoomController, RoomVoice } from '@watchparty/ui/room';
import Link from 'next/link';
import { detectExtension, handOver, listenForReturn } from '@/lib/extension';
import { forgetBrowserSession, getBrowserClient } from '@/lib/supabase/client';
import { Wordmark } from '@/components/Wordmark';

// Handing the room to the sync extension on a computer, so a Netflix, Prime Video or Disney+ tab
// can auto sync. Only one holder may refresh a session (Supabase revokes a refresh token used
// twice), so this page stops refreshing, passes the session, and forgets it without signing out.

const extensionIdKey = 'watchparty:extension-id';

/** What to tell the member when the extension does not take the room. */
function refusalSentence(reason: string | null, service: string, isHost: boolean): string {
  switch (reason) {
    case 'not_a_watch_page':
      return isHost
        ? `That address isn't a ${service} watch page. Start the title playing on ${service}, copy the address, and set it in Room settings.`
        : `The room's ${service} address isn't a watch page. Ask the host to set the address of the title while it plays.`;
    case 'invalid_content_ref':
    case 'unsupported_source':
      return `The sync extension can't open this room's ${service} title.`;
    case 'tab_failed':
      return `The sync extension couldn't open a ${service} tab. Try again.`;
    default:
      return 'The sync extension did not answer. Check it is turned on, then try again.';
  }
}

export function ExtensionSlot({
  controller,
  room,
  voice,
  onRejoin,
}: {
  controller: RoomController;
  room: RoomRow;
  voice: RoomVoice;
  onRejoin: () => void;
}) {
  const [extensionId, setExtensionId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const service = SOURCE_LABEL[room.source];
  const isHost = room.host_id === controller.userId;

  useEffect(() => {
    let cancelled = false;
    void detectExtension().then((id) => !cancelled && setExtensionId(id));
    return () => {
      cancelled = true;
    };
  }, []);

  if (extensionId === undefined) return null;
  if (!extensionId) {
    return (
      <Link
        href="/extension"
        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-amber ring-1 ring-inset ring-amber/50 hover:bg-amber/10"
      >
        <Icon name="puzzle" size={18} />
        Get automatic sync
      </Link>
    );
  }

  async function start() {
    if (!extensionId || !room.content_ref) return;
    setBusy(true);
    const supabase = getBrowserClient();
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setBusy(false);
      toast(refusalSentence(null, service, isHost), 'error');
      return;
    }
    supabase.auth.stopAutoRefresh();
    await voice.leave();
    const handed = await controller.handOver();
    if (!handed) {
      supabase.auth.startAutoRefresh();
      setBusy(false);
      toast(refusalSentence(null, service, isHost), 'error');
      return;
    }
    const result = await handOver(extensionId, {
      type: 'handover',
      room_id: handed.roomId,
      slug: handed.slug,
      source: room.source,
      content_ref: room.content_ref,
      engine_session: handed.engineSession,
      session: { access_token: session.access_token, refresh_token: session.refresh_token },
    });
    if (result.ok) {
      try {
        sessionStorage.setItem(extensionIdKey, extensionId);
      } catch {
        // Only needed to reconnect the return port after a reload.
      }
      forgetBrowserSession();
    } else {
      // The extension did not take it: keep the session here, say why, and rejoin the room.
      supabase.auth.startAutoRefresh();
      setBusy(false);
      toast(refusalSentence(result.reason, service, isHost), 'error');
      onRejoin();
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      <Button variant="primary" icon="play" busy={busy} disabled={!room.content_ref} onClick={() => void start()}>
        Open in {service} with sync
      </Button>
    </div>
  );
}

export function HandedOver({ room, onReturned }: { controller: RoomController; room: RoomRow; onReturned: () => void }) {
  const [asking, setAsking] = useState(false);
  const port = useRef<ReturnType<typeof listenForReturn> | null>(null);
  const service = SOURCE_LABEL[room.source];

  useEffect(() => {
    let extensionId: string | null = null;
    try {
      extensionId = sessionStorage.getItem(extensionIdKey);
    } catch {
      extensionId = null;
    }
    if (!extensionId) return;
    port.current = listenForReturn(extensionId, room.id, async (message) => {
      // The extension gave the session back (it was asked, or its tab closed).
      const supabase = getBrowserClient();
      await supabase.auth.setSession(message.session);
      port.current?.close();
      onReturned();
    });
    return () => port.current?.close();
  }, [room.id, onReturned]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top px-4 sm:px-6">
        <Wordmark />
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 pb-16 sm:px-6">
        <div className="flex flex-col gap-3" data-testid="handed-over">
          <p className="slate">{room.title}</p>
          <h1 className="marquee text-6xl">Watching in your {service} tab</h1>
          <p className="text-muted">
            Chat, voice and reactions are in the panel on the right of that tab. This page stays quiet so the room only
            hears you once.
          </p>
        </div>
        <Button
          variant="secondary"
          size="lg"
          icon="chevronLeft"
          busy={asking}
          onClick={() => {
            setAsking(true);
            port.current?.reclaim();
            setTimeout(() => setAsking(false), 5000);
          }}
        >
          Bring it back here
        </Button>
        <p className="text-sm text-faint">
          Closing the {service} tab also brings the room back here, if this page is still open.
        </p>
      </main>
    </div>
  );
}
