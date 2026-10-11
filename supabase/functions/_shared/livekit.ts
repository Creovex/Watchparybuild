// LiveKit server access: join tokens and the participant changes moderation needs.

import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { readEnv, type Env } from './env.ts';

/** Join tokens last 10 minutes: enough to connect. Reconnects fetch a new one, so a removed user cannot return. */
export const TOKEN_TTL_SECONDS = 600;

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export function liveKitConfig(env: Env): LiveKitConfig | null {
  const url = readEnv(env, 'LIVEKIT_URL');
  const apiKey = readEnv(env, 'LIVEKIT_API_KEY');
  const apiSecret = readEnv(env, 'LIVEKIT_API_SECRET');
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

/**
 * Publish permission for a member. Only microphone and camera may be published, so nobody can share
 * a screen (which would redistribute a streaming service's video), and data messages are off
 * because the app sends none through LiveKit.
 */
export function publishPermission(canPublish: boolean) {
  return {
    canSubscribe: true,
    canPublish,
    canPublishData: false,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [],
  };
}

export async function createJoinToken(
  config: LiveKitConfig,
  args: { roomId: string; userId: string; name?: string },
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: args.userId,
    ttl: TOKEN_TTL_SECONDS,
    ...(args.name ? { name: args.name } : {}),
  });
  token.addGrant({ room: args.roomId, roomJoin: true, ...publishPermission(true) });
  return await token.toJwt();
}

/** The two LiveKit room service calls moderation makes. */
export interface ParticipantAdmin {
  updateParticipant(
    room: string,
    identity: string,
    options: { permission: ReturnType<typeof publishPermission> },
  ): Promise<unknown>;
  removeParticipant(room: string, identity: string): Promise<unknown>;
}

export function roomServiceFromEnv(env: Env): ParticipantAdmin | null {
  const config = liveKitConfig(env);
  if (!config) return null;
  // The client turns a wss:// address into https:// itself.
  return new RoomServiceClient(config.url, config.apiKey, config.apiSecret);
}

/** LiveKit answers "not found" when the participant is not connected, which is fine for every action. */
export function isParticipantNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; message?: unknown } | null;
  if (!e) return false;
  return e.code === 'not_found' || e.status === 404 || (typeof e.message === 'string' && /not found/i.test(e.message));
}
