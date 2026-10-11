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

export async function handOver(extensionId: string, message: HandoverMessage): Promise<boolean> {
  const reply = await send(extensionId, message, 4000);
  return reply?.type === 'handover_ok';
}

/**
 * Keeps a port open to the extension while it holds the session, so it can give the session back
 * when its tab closes, and so the page can ask for it back ("Bring it back here").
 */
export function listenForReturn(extensionId: string, roomId: string, onReturn: (msg: ReturnMessage) => void) {
  const rt = runtime();
  if (!rt) return { reclaim: () => undefined, close: () => undefined };
  const port = rt.connect(extensionId, { name: `room-page:${roomId}` });
  port.onMessage.addListener((message) => {
    const parsed = ExtensionReply.safeParse(message);
    if (parsed.success && parsed.data.type === 'return' && parsed.data.room_id === roomId) onReturn(parsed.data);
  });
  return {
    reclaim: () => port.postMessage({ type: 'reclaim', room_id: roomId } satisfies PageToExtension),
    close: () => port.disconnect(),
  };
}
