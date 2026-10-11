// Keys in `chrome.storage.session`, shared by the service worker and the panel.

/** The handover record for a room. */
export const roomKey = (roomId: string) => `room:${roomId}`;
/** Which room a streaming tab holds. */
export const tabKey = (tabId: number) => `tab:${tabId}`;
/** The newest token pair; the panel writes it on every refresh. */
export const tokensKey = (roomId: string) => `tokens:${roomId}`;
/** Supabase's own session storage for the panel's client. */
export const authKey = (roomId: string) => `auth:${roomId}`;
