import { ModerationState } from './moderation';
import { Listeners, browserAudioContext, browserClock, defaultLogger } from './runtime';
import type { Clock, LocalMedia, Logger, VoiceError, VoiceState, VoiceTracks } from './types';

export interface VoiceBaseDeps {
  createAudioContext?: () => AudioContext;
  clock?: Clock;
  log?: Logger;
}

/** Listener plumbing, state and the audio context, shared by both implementations. */
export abstract class VoiceBase {
  protected readonly clock: Clock;
  protected readonly log: Logger;
  protected readonly moderation = new ModerationState();
  protected readonly stateListeners: Listeners<[VoiceState]>;
  protected readonly speakingListeners: Listeners<[string, boolean]>;
  protected readonly trackListeners: Listeners<[string, VoiceTracks]>;
  protected readonly mediaListeners: Listeners<[LocalMedia]>;
  protected readonly errorListeners: Listeners<[VoiceError]>;

  protected state: VoiceState | 'idle' = 'idle';
  protected me: string | null = null;
  protected context: AudioContext | null = null;

  constructor(private readonly baseDeps: VoiceBaseDeps) {
    this.clock = baseDeps.clock ?? browserClock;
    this.log = baseDeps.log ?? defaultLogger;
    this.stateListeners = new Listeners(this.log);
    this.speakingListeners = new Listeners(this.log);
    this.trackListeners = new Listeners(this.log);
    this.mediaListeners = new Listeners(this.log);
    this.errorListeners = new Listeners(this.log);
  }

  abstract getLocalMedia(): LocalMedia;

  prepareAudio(): void {
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = (this.baseDeps.createAudioContext ?? browserAudioContext)();
      }
      if (this.context.state === 'suspended') {
        this.context.resume().catch((err: unknown) => this.log('could not resume audio', err));
      }
    } catch (err) {
      this.log('could not start audio', err);
    }
  }

  getState(): VoiceState | 'idle' {
    return this.state;
  }

  onSpeaking(cb: (userId: string, speaking: boolean) => void): () => void {
    return this.speakingListeners.add(cb);
  }

  onState(cb: (s: VoiceState) => void): () => void {
    return this.stateListeners.add(cb);
  }

  onLocalMedia(cb: (media: LocalMedia) => void): () => void {
    return this.mediaListeners.add(cb);
  }

  onError(cb: (error: VoiceError) => void): () => void {
    return this.errorListeners.add(cb);
  }

  /** True between the start of a join and leave or failure. */
  protected get active(): boolean {
    return this.state === 'connecting' || this.state === 'connected' || this.state === 'reconnecting';
  }

  protected setState(next: VoiceState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.emit(next);
  }

  protected emitLocalMedia(): void {
    this.mediaListeners.emit(this.getLocalMedia());
  }

  /** Leaves the audio context suspended between joins; `prepareAudio` resumes it inside the next tap. */
  protected suspendAudio(): void {
    if (this.context && this.context.state === 'running') this.context.suspend().catch(() => {});
  }
}
