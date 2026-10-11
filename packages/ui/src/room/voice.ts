'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ducker, type PresencePayload } from '@watchparty/sync-core';
import {
  createVoiceClient,
  type LocalMedia,
  type RoomVoiceClient,
  type VoiceErrorCode,
  type VoicePresence as VoicePresenceRow,
  type VoiceState,
} from '@watchparty/voice';
import type { RoomController } from './controller';
import { useRoom } from './hooks';

// Voice for the room page and the extension panel. Only the engine owner joins voice; the room's
// voice mode picks mesh or server voice inside createVoiceClient, and nothing here knows which.

export interface RoomVoice {
  state: VoiceState | 'idle';
  local: LocalMedia;
  speaking: Set<string>;
  cameras: Set<string>;
  error: VoiceErrorCode | null;
  /** Must be called from the "Join voice" tap: it prepares audio before any await. */
  join(): void;
  leave(): Promise<void>;
  setMic(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  attach(userId: string, kind: 'audio' | 'video', el: HTMLMediaElement): () => void;
  onSpeaking(cb: (userId: string, speaking: boolean) => void): () => void;
}

const NO_MEDIA: LocalMedia = { micEnabled: false, cameraEnabled: false, hostMuted: false };

export function useRoomVoice(controller: RoomController): RoomVoice {
  const { room, members, presence } = useRoom(controller);
  const clientRef = useRef<RoomVoiceClient | null>(null);
  const presenceRef = useRef<PresencePayload[]>(presence);
  const presenceListeners = useRef(new Set<(rows: readonly VoicePresenceRow[]) => void>());
  const speakingListeners = useRef(new Set<(userId: string, speaking: boolean) => void>());
  const [state, setState] = useState<VoiceState | 'idle'>('idle');
  const [local, setLocal] = useState<LocalMedia>(NO_MEDIA);
  const [speaking, setSpeaking] = useState<Set<string>>(() => new Set());
  const [cameras, setCameras] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<VoiceErrorCode | null>(null);
  const roomId = room?.id ?? null;
  const voiceMode = room?.voice_mode ?? 'mesh';

  // Feed presence changes to mesh voice, which starts connections when a peer turns voice on.
  useEffect(() => {
    presenceRef.current = presence;
    const rows = presence.map((p) => ({ user_id: p.user_id, voice: p.voice }));
    for (const cb of presenceListeners.current) cb(rows);
  }, [presence]);

  const client = useCallback((): RoomVoiceClient | null => {
    if (clientRef.current) return clientRef.current;
    const session = controller.session;
    if (!session) return null;
    const voice = createVoiceClient(voiceMode, {
      getIceServers: async () => {
        const res = await controller.api.turnCredentials(session.roomId, session.engineSession);
        if (!res.ok) throw Object.assign(new Error(res.code), { code: res.code });
        return res.data.iceServers as RTCIceServer[];
      },
      getToken: async () => {
        const res = await controller.api.livekitToken(session.roomId, session.engineSession);
        if (!res.ok) throw Object.assign(new Error(res.code), { code: res.code });
        return res.data;
      },
      signalling: {
        send: (event) => controller.sendRtc(event),
        onEvent: (cb) => controller.onRtc(cb),
      },
      presence: {
        get: () => presenceRef.current.map((p) => ({ user_id: p.user_id, voice: p.voice })),
        subscribe: (cb) => {
          presenceListeners.current.add(cb);
          return () => presenceListeners.current.delete(cb);
        },
      },
    });
    voice.onState((s) => setState(s));
    voice.onLocalMedia((media) => setLocal(media));
    voice.onError((err) => setError(err.code));
    voice.onSpeaking((userId, isSpeaking) => {
      setSpeaking((current) => {
        const next = new Set(current);
        if (isSpeaking) next.add(userId);
        else next.delete(userId);
        return next;
      });
      for (const cb of speakingListeners.current) cb(userId, isSpeaking);
    });
    voice.onTracks((userId, tracks) => {
      setCameras((current) => {
        const next = new Set(current);
        if (tracks.video) next.add(userId);
        else next.delete(userId);
        return next;
      });
    });
    clientRef.current = voice;
    return voice;
  }, [controller, voiceMode]);

  // Host mutes and removals reach voice from the server topic and from member rows.
  useEffect(() => controller.onModeration((event) => clientRef.current?.handleModeration(event)), [controller]);
  const mutedKey = members.map((m) => `${m.user_id}:${m.voice_muted ? 1 : 0}`).join(',');
  useEffect(() => {
    const voice = clientRef.current;
    if (!voice) return;
    for (const m of members) voice.handleModeration({ target: m.user_id, action: m.voice_muted ? 'mute_voice' : 'unmute_voice' });
    // members is read through mutedKey so this runs only when a mute changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutedKey]);

  // Presence shows everyone whether this member is in voice and whether their mic is on.
  useEffect(() => {
    const presenceVoice = state === 'idle' || state === 'failed' ? 'off' : local.micEnabled && !local.hostMuted ? 'live' : 'muted';
    controller.setVoicePresence(presenceVoice);
  }, [controller, state, local.micEnabled, local.hostMuted]);

  useEffect(
    () => () => {
      void clientRef.current?.leave();
      clientRef.current = null;
    },
    [roomId],
  );

  const join = useCallback(() => {
    const voice = client();
    if (!voice || !controller.session) return;
    setError(null);
    voice.prepareAudio();
    for (const m of controller.store.get().members) {
      if (m.voice_muted) voice.handleModeration({ target: m.user_id, action: 'mute_voice' });
    }
    void voice.join({ roomId: controller.session.roomId, userId: controller.userId }).catch(() => undefined);
  }, [client, controller]);

  const leave = useCallback(async () => {
    await clientRef.current?.leave();
    setSpeaking(new Set());
    setCameras(new Set());
  }, []);

  const setMic = useCallback(async (on: boolean) => {
    await clientRef.current?.setMicEnabled(on).catch(() => undefined);
  }, []);

  const setCamera = useCallback(async (on: boolean) => {
    await clientRef.current?.setCameraEnabled(on).catch(() => undefined);
  }, []);

  const attach = useCallback((userId: string, kind: 'audio' | 'video', el: HTMLMediaElement) => {
    return clientRef.current?.attachMedia(userId, kind, el) ?? (() => undefined);
  }, []);

  const onSpeaking = useCallback((cb: (userId: string, speaking: boolean) => void) => {
    speakingListeners.current.add(cb);
    return () => speakingListeners.current.delete(cb);
  }, []);

  return useMemo(
    () => ({ state, local, speaking, cameras, error, join, leave, setMic, setCamera, attach, onSpeaking }),
    [state, local, speaking, cameras, error, join, leave, setMic, setCamera, attach, onSpeaking],
  );
}

/**
 * Ducking: lowers the movie while another member speaks, wherever the player's volume can be set.
 * `level` is the fraction of the member's movie volume to keep, or null for off.
 */
export function useDucking(controller: RoomController, voice: RoomVoice, level: number | null): void {
  const { engine } = useRoom(controller);
  const host = controller.engineHost;
  const available = Boolean(host?.capabilities.volume);
  const levelRef = useRef(level);
  const duckerRef = useRef<Ducker | null>(null);

  useEffect(() => {
    levelRef.current = level;
    duckerRef.current?.setDuckLevel(level);
  }, [level]);

  useEffect(() => {
    if (!available || !host || voice.state === 'idle') {
      duckerRef.current = null;
      return;
    }
    const ducker = new Ducker(
      { getVolume: () => host.getVolume(), setVolume: (v) => host.setVolume(v), now: () => performance.now() },
      levelRef.current,
    );
    duckerRef.current = ducker;
    const off = voice.onSpeaking((userId, isSpeaking) => ducker.setSpeaking(userId, isSpeaking, userId === controller.userId));
    const timer = setInterval(() => ducker.tick(), 50);
    return () => {
      off();
      clearInterval(timer);
      duckerRef.current = null;
    };
    // engine identity changes when a new player attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, host, voice.state === 'idle', engine === null]);
}
