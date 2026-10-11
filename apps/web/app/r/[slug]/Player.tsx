'use client';

import { useEffect, useRef, useState } from 'react';
import type { RoomRow } from '@watchparty/sync-core';
import { Icon, Notice } from '@watchparty/ui';
import { LocalEngineHost, SourcePicker, type RoomController } from '@watchparty/ui/room';
import { YouTubeAdapter, type YouTubeErrorKind } from '@/lib/adapters/youtube';
import { StubAdapter } from '@/lib/adapters/stub';
import { E2E_STUB } from '@/lib/env';
import { CLIENT_SENTENCES } from '@/lib/errors';

/**
 * The YouTube player and its engine. The frame keeps 16 by 9 and never has anything of ours on top
 * of it; its height is capped so the rest of the room still fits on a laptop screen.
 */
export function Player({
  controller,
  room,
  onHost,
}: {
  controller: RoomController;
  room: RoomRow;
  onHost?: (host: LocalEngineHost | null) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<YouTubeErrorKind | 'load' | null>(null);
  const contentRef = room.content_ref;
  const isHost = room.host_id === controller.userId;

  useEffect(() => {
    const el = frame.current;
    if (!el || !contentRef) return;
    setError(null);
    let cancelled = false;
    let host: LocalEngineHost | null = null;
    const adapter = E2E_STUB ? new StubAdapter(el) : new YouTubeAdapter(el);
    const offError = adapter instanceof YouTubeAdapter ? adapter.onError((kind) => setError(kind)) : () => undefined;
    adapter
      .load(contentRef)
      .then(() => {
        if (cancelled) return;
        host = new LocalEngineHost(adapter, () => controller.clock.now(), (entry) => {
          if (entry.event === 'cant_keep_up') {
            console.warn('[sync] cant_keep_up', { device: navigator.userAgent, source: room.source, ...entry.detail });
          }
        });
        controller.attachEngine(host);
        onHost?.(host);
      })
      .catch(() => !cancelled && setError('load'));
    return () => {
      cancelled = true;
      offError();
      controller.detachEngine();
      onHost?.(null);
      host?.stop();
      adapter.destroy();
    };
    // room.source only matters for logging; the player restarts when the content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, contentRef]);

  return (
    <div className="w-full bg-black">
      <div
        className="relative mx-auto aspect-video w-full lg:max-w-[calc((100dvh-17rem)*16/9)]"
        data-testid="player"
      >
        <div ref={frame} className="absolute inset-0" />
        {!contentRef ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Icon name="play" size={32} className="text-faint" />
            <p className="font-semibold">{isHost ? 'Pick a video to start' : 'The host is picking a video'}</p>
            {isHost ? <p className="text-sm text-muted">Open Room settings to choose what everyone watches.</p> : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <div className="flex flex-col gap-3 bg-surface-1 p-3" role="alert">
          <Notice tone="error" title={error === 'load' ? 'The YouTube player did not load.' : undefined}>
            {error === 'load' ? 'Check your connection, then reload the page.' : CLIENT_SENTENCES.embed_blocked}
          </Notice>
          {isHost && error !== 'load' ? (
            <div className="rounded-xl bg-surface-2 p-3">
              <p className="mb-2 font-semibold">Pick another video</p>
              <SourcePicker compact />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
