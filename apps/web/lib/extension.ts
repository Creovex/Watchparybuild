'use client';

import { ExtensionReply, type HandoverMessage, type PageToExtension, type ReturnMessage } from '@watchparty/sync-core';
import { EXTENSION_IDS } from './env';

// Talking to the sync extension from the room page. The extension lists this site in its
// `externally_connectable` key, so Chrome and Edge expose chrome.runtime here for it.

interface ChromePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

interface ChromeRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
  connect(extensionId: string, info?: { name?: string }): ChromePort;
  lastError?: { message?: string };
}

function runtime(): ChromeRuntime | null {
  const chrome = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return chrome?.runtime && typeof chrome.runtime.sendMessage === 'function' ? chrome.runtime : null;
}

function send(extensionId: string, message: PageToExtension, timeoutMs = 1500): Promise<ExtensionReply | null> {
  const rt = runtime();
  if (!rt) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      rt.sendMessage(extensionId, message, (response) => {
        clearTimeout(timer);
        if (rt.lastError) {
          resolve(null);
          return;
        }
        const parsed = ExtensionReply.safeParse(response);
        resolve(parsed.success ? parsed.data : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** The id of an installed sync extension that answered, or null. */
export async function detectExtension(): Promise<string | null> {
  for (const id of EXTENSION_IDS) {
    const reply = await send(id, { type: 'ping' });
    if (reply?.type === 'pong') return id;
  }
  return null;
}

export type HandoverResult = { ok: true } | { ok: false; reason: string | null };

/** `reason` is the extension's refusal reason, or null when it did not answer. */
export async function handOver(extensionId: string, message: HandoverMessage): Promise<HandoverResult> {
  const reply = await send(extensionId, message, 4000);
  if (reply?.type === 'handover_ok') return { ok: true };
  return { ok: false, reason: reply?.type === 'handover_refused' ? reply.reason : null };
}

/**
 * Keeps a port open to the extension while it holds the session, so it can give the session back
 * when its tab closes, and so the page can ask for it back ("Bring it back here"). The browser may
 * restart the extension's service worker, which closes the port, so the port is reopened, and a
 * reclaim also goes as a one off message the extension answers directly.
 */
export function listenForReturn(extensionId: string, roomId: string, onReturn: (msg: ReturnMessage) => void) {
  const rt = runtime();
  if (!rt) return { reclaim: () => undefined, close: () => undefined };
  let port: ChromePort | null = null;
  let closed = false;
  let returned = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const deliver = (message: unknown) => {
    const parsed = ExtensionReply.safeParse(message);
    if (returned || !parsed.success || parsed.data.type !== 'return' || parsed.data.room_id !== roomId) return;
    returned = true;
    onReturn(parsed.data);
  };

  const open = (attempt = 0) => {
    if (closed) return;
    try {
      const next = rt.connect(extensionId, { name: `room-page:${roomId}` });
      next.onMessage.addListener(deliver);
      next.onDisconnect.addListener(() => {
        if (port === next) port = null;
        // Reopening wakes a restarted service worker; back off so a removed extension is not polled hard.
        if (!closed && !returned) retry = setTimeout(() => open(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
      });
      port = next;
    } catch {
      if (!closed) retry = setTimeout(() => open(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
    }
  };
  open();

  return {
    reclaim: () => {
      const message = { type: 'reclaim', room_id: roomId } satisfies PageToExtension;
      if (port) port.postMessage(message);
      // Also ask directly; whichever answer comes first is used.
      void send(extensionId, message, 5000).then((reply) => reply && deliver(reply));
    },
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      port?.disconnect();
      port = null;
    },
  };
}
