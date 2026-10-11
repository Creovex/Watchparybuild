import { WorkerCore, type KeyValueStore } from './background/core';
import { PortPairing, type PortKind } from './background/pairing';
import {
  ContentToPanel,
  PanelToContent,
  PanelToWorker,
  PORT_CONTENT,
  PORT_PANEL,
  roomIdFromPortName,
} from './shared/messages';
import { pageOrigins } from './shared/env';
import { sourceForHost } from './shared/services';

// The service worker: answers the room page (detection, handover, giving the session back), and
// relays between each streaming tab's content script and its panel. It never touches the network.
// The content script and panel exchange messages several times a second while a room is open, which
// keeps this worker alive; if the browser restarts it anyway, both sides reconnect on their own.

const PANEL_PATH = 'src/panel/panel.html';

const store: KeyValueStore = {
  get: (keys) => chrome.storage.session.get(keys),
  set: (items) => chrome.storage.session.set(items),
  remove: (keys) => chrome.storage.session.remove(keys),
};

const pairing = new PortPairing<chrome.runtime.Port>();

const core = new WorkerCore({
  store,
  version: chrome.runtime.getManifest().version,
  allowedOrigins: pageOrigins(),
  openTab: async (url) => {
    try {
      const tab = await chrome.tabs.create({ url, active: true });
      return tab.id ?? null;
    } catch {
      return null;
    }
  },
  notifyBinding: (tabId, roomId) => {
    pairing.send(tabId, 'content', { type: 'bound', bound: roomId !== null });
    pairing.send(tabId, 'panel', { type: 'bind', room_id: roomId });
  },
  sendStop: (tabId, reason) => pairing.send(tabId, 'panel', { type: 'stop', reason }),
  log: (message, detail) => console.warn(`[worker] ${message}`, detail),
});

function originOf(sender: chrome.runtime.MessageSender): string | undefined {
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : undefined;
  } catch {
    return undefined;
  }
}

// The room page: ping, handover, reclaim -----------------------------------------------------------

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void core.handleExternal(message, originOf(sender)).then(sendResponse, () =>
    sendResponse({ type: 'handover_refused', reason: 'internal' }),
  );
  return true;
});

chrome.runtime.onConnectExternal.addListener((port) => {
  const roomId = roomIdFromPortName(port.name);
  const origin = port.sender ? originOf(port.sender) : undefined;
  if (!roomId || !origin || !pageOrigins().includes(origin)) {
    port.disconnect();
    return;
  }
  port.onMessage.addListener((message) => void core.handleRoomPageMessage(roomId, port, message));
  port.onDisconnect.addListener(() => core.removeRoomPagePort(roomId, port));
  void core.addRoomPagePort(roomId, port);
});

// Content scripts and panels -----------------------------------------------------------------------

function kindOf(port: chrome.runtime.Port): PortKind | null {
  const sender = port.sender;
  if (!sender || sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return null;
  if (port.name === PORT_CONTENT) {
    // Content scripts run only in the top frame of a streaming service page.
    const host = sender.url ? safeHost(sender.url) : null;
    return sender.frameId === 0 && host && sourceForHost(host) ? 'content' : null;
  }
  if (port.name === PORT_PANEL) {
    return sender.url?.startsWith(chrome.runtime.getURL(PANEL_PATH)) ? 'panel' : null;
  }
  return null;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  const kind = kindOf(port);
  const tabId = port.sender?.tab?.id;
  if (!kind || tabId === undefined) {
    port.disconnect();
    return;
  }
  pairing.connect(tabId, kind, port);
  void core.bindingFor(tabId).then((roomId) => {
    if (pairing.get(tabId, kind) !== port) return;
    port.postMessage(kind === 'content' ? { type: 'bound', bound: roomId !== null } : { type: 'bind', room_id: roomId });
  });

  port.onMessage.addListener((message) => {
    if (kind === 'panel') {
      const forWorker = PanelToWorker.safeParse(message);
      if (forWorker.success) {
        void core.handlePanelMessage(forWorker.data, tabId);
        return;
      }
      if (PanelToContent.safeParse(message).success) pairing.relay(tabId, 'panel', port, message);
      return;
    }
    if (ContentToPanel.safeParse(message).success) pairing.relay(tabId, 'content', port, message);
  });
  port.onDisconnect.addListener(() => pairing.disconnect(tabId, kind, port));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pairing.removeTab(tabId);
  void core.onTabRemoved(tabId);
});
