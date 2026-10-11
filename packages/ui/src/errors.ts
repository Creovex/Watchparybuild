import { ERROR_CODES, SILENT_CODES, type ErrorCode } from '@watchparty/sync-core';
import type { VoiceOnlyErrorCode } from '@watchparty/voice';

// One sentence for every code an RPC or Edge Function can return, shared by the web app and the
// extension panel. Codes in SILENT_CODES are handled by the app and never shown. No raw error text, stack trace or code ever reaches the
// screen: anything unknown becomes the `internal` sentence. James reviews these at handover.

export interface ErrorContext {
  /** The room's cap, for the room_full sentence. */
  roomCap?: number;
}

const SENTENCES: Record<ErrorCode, string | ((ctx: ErrorContext) => string)> = {
  invalid_input: 'Something in that request was not valid. Check the details and try again.',
  too_many_rooms: 'You already host 20 open rooms. Close one before starting another.',
  internal: 'Something went wrong on our side. Try again in a moment.',
  not_found: "This room doesn't exist. Check the link with whoever sent it.",
  closed: 'This room was closed.',
  locked: 'The host has locked this room, so only people who were here before can come in.',
  banned: "You can't join this room.",
  removed: 'You were removed from this room. The host can let you back in.',
  bad_key:
    'This private room link is missing its key or the key has changed. Ask the host for a new link.',
  room_full: ({ roomCap }) =>
    roomCap === 10
      ? 'This room is full (10 of 10).'
      : 'This room is full (3 of 3). Rooms of 10 come with paid plans, coming soon.',
  not_member: "You're not in this room any more. Join again from the room link.",
  replaced: 'You opened this room somewhere else.',
  not_controller: 'Only the host controls playback.',
  not_elected: '',
  stale_seq: '',
  not_host: 'Only the host can do that.',
  not_allowed: "You can't delete that message.",
  rate_limited: "You're sending messages too fast. Wait a few seconds.",
  unauthorized: 'Your sign in has expired. Sign in again to continue.',
  wrong_voice_mode: "Voice for this room isn't set up the way this request expected. Leave voice and join again.",
  voice_muted: 'The host muted you.',
  voice_sync_failed:
    "The change was saved, but the voice server didn't confirm it. It applies the next time they reconnect.",
};

/** Messages for problems the browser finds before anything reaches the server. */
export const CLIENT_SENTENCES = {
  offline: "You're offline. The room reconnects when your connection is back.",
  live_stream: "Live streams can't be synced.",
  bad_youtube_link: "That doesn't look like a YouTube video link.",
  bad_title_link: 'Paste the address of the title from the service, starting with https://',
  embed_blocked: "This video can't be played outside YouTube.",
  mic_denied: 'Microphone access was blocked. Allow it in your browser settings to talk.',
  camera_denied: 'Camera access was blocked. Allow it in your browser settings to show your camera.',
  voice_failed: 'Voice disconnected, tap to rejoin.',
} as const;

/** Sentences for the codes voice adds (packages/voice VOICE_ONLY_ERROR_CODES). */
export const VOICE_SENTENCES: Record<VoiceOnlyErrorCode, string> = {
  mic_denied: 'Microphone access was blocked. Allow it in your browser settings to talk.',
  camera_denied: 'Camera access was blocked. Allow it in your browser settings to show your camera.',
  device_unavailable: "Your microphone or camera isn't available. Check that no other app is using it.",
  host_muted: 'The host muted you.',
  disconnected: 'Voice disconnected, tap to rejoin.',
  replaced: 'You opened this room somewhere else.',
};

export function voiceErrorSentence(code: string): string {
  return (VOICE_SENTENCES as Record<string, string>)[code] ?? errorSentence(code);
}

export function isSilent(code: ErrorCode): boolean {
  return SILENT_CODES.includes(code);
}

/** The sentence for a code; unknown codes get the `internal` sentence. */
export function errorSentence(code: string, ctx: ErrorContext = {}): string {
  const known = (ERROR_CODES as string[]).includes(code) ? (code as ErrorCode) : 'internal';
  const entry = SENTENCES[known];
  const text = typeof entry === 'function' ? entry(ctx) : entry;
  return text || (SENTENCES.internal as string);
}

export const ERROR_SENTENCES = SENTENCES;
