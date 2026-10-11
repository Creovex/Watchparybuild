import { MeshVoice, type MeshVoiceDeps } from './mesh';
import { ServerVoice, type ServerVoiceDeps } from './server';
import type { RoomVoiceClient } from './types';

/**
 * Everything either implementation may need. The room supplies all of it; the voice mode decides
 * which parts are used.
 */
export type VoiceDeps = MeshVoiceDeps & ServerVoiceDeps;

/**
 * The only way the room page and the extension panel create voice. `mesh` rooms (cap 3) get direct
 * connections between members; `server` rooms (cap 10) go through LiveKit.
 */
export function createVoiceClient(voiceMode: 'mesh' | 'server', deps: VoiceDeps): RoomVoiceClient {
  switch (voiceMode) {
    case 'mesh':
      return new MeshVoice(deps);
    case 'server':
      return new ServerVoice(deps);
    default:
      throw new Error(`unknown voice mode: ${String(voiceMode)}`);
  }
}
