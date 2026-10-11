// Reads what someone pastes to join a room. An app added to the iPhone home screen has no address
// bar, and links tapped in Messages open in Safari rather than in the app, so pasting is the way in.

const SLUG = /^[A-Za-z0-9_-]{10}$/;
const JOIN_KEY = /^[A-Za-z0-9_-]{22}$/;
const ROOM_PATH = /^\/r\/([A-Za-z0-9_-]{10})\/?$/;

export type RoomLinkResult = { ok: true; path: string } | { ok: false };

/**
 * Accepts a full room link, a link without `https://`, or a bare room code. Only the room code and
 * the join key are kept, checked against the same patterns the database uses, so the result is
 * always a path on this site whatever address was pasted.
 */
export function parseRoomLink(raw: string): RoomLinkResult {
  const text = raw.trim();
  if (!text) return { ok: false };
  if (SLUG.test(text)) return { ok: true, path: `/r/${text}` };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false };
  }
  const match = ROOM_PATH.exec(url.pathname);
  if (!match) return { ok: false };
  const key = new URLSearchParams(url.hash.replace(/^#/, '')).get('k');
  if (key !== null && !JOIN_KEY.test(key)) return { ok: false };
  return { ok: true, path: `/r/${match[1]}${key ? `#k=${key}` : ''}` };
}
