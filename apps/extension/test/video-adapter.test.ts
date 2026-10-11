// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { INPUT_WINDOW_MS, pickActiveVideo, VideoElementAdapter } from '../src/content/video-adapter';
import { S1_RESULTS } from '../src/shared/services';
import { flush } from './helpers';

interface VideoState {
  paused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  readyState: number;
  ended: boolean;
  seeking: boolean;
  playError: { name: string } | null;
}

/** A real video element whose media state the test controls. */
function makeVideo(init: Partial<VideoState> = {}) {
  const video = document.createElement('video');
  const state: VideoState = {
    paused: true,
    currentTime: 0,
    duration: 1200,
    volume: 1,
    playbackRate: 1,
    readyState: 4,
    ended: false,
    seeking: false,
    playError: null,
    ...init,
  };
  for (const key of ['paused', 'duration', 'readyState', 'ended', 'seeking'] as const) {
    Object.defineProperty(video, key, { configurable: true, get: () => state[key] });
  }
  for (const key of ['currentTime', 'volume', 'playbackRate'] as const) {
    Object.defineProperty(video, key, {
      configurable: true,
      get: () => state[key],
      set: (value: number) => {
        state[key] = value;
      },
    });
  }
  video.play = async () => {
    if (state.playError) throw state.playError;
    state.paused = false;
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
  };
  video.pause = () => {
    state.paused = true;
    video.dispatchEvent(new Event('pause'));
  };
  const fire = (name: string) => video.dispatchEvent(new Event(name));
  return { video, state, fire };
}

const areas = new Map<HTMLVideoElement, number>();
const measure = (v: HTMLVideoElement) => areas.get(v) ?? 0;
let adapter: VideoElementAdapter | null = null;
let clock = 10_000;

function create(options: { requireInput?: boolean; caps?: Partial<typeof S1_RESULTS.netflix.capabilities> } = {}) {
  adapter = new VideoElementAdapter({
    doc: document,
    capabilities: { ...S1_RESULTS.netflix.capabilities, ...options.caps },
    measure,
    now: () => clock,
    requireInput: options.requireInput ?? false,
    isMemberInput: () => true,
  });
  return adapter;
}

afterEach(() => {
  adapter?.destroy();
  adapter = null;
  areas.clear();
  document.body.replaceChildren();
});

describe('choosing the video', () => {
  it('prefers visible, then larger, then playing, then longer videos', () => {
    const hidden = makeVideo({ paused: false, duration: 9000 }).video;
    const small = makeVideo().video;
    const big = makeVideo().video;
    areas.set(small, 100);
    areas.set(big, 10_000);
    expect(pickActiveVideo([hidden, small, big], measure)).toBe(big);

    const a = makeVideo({ duration: 100 }).video;
    const b = makeVideo({ duration: 100, paused: false }).video;
    areas.set(a, 500);
    areas.set(b, 500);
    expect(pickActiveVideo([a, b], measure)).toBe(b);

    const short = makeVideo({ duration: 30 }).video;
    const long = makeVideo({ duration: 3000 }).video;
    expect(pickActiveVideo([short, long], measure)).toBe(long);
    expect(pickActiveVideo([], measure)).toBeNull();
  });

  it('follows the service when it replaces the video element', async () => {
    const first = makeVideo();
    areas.set(first.video, 1000);
    document.body.append(first.video);
    const a = create();
    expect(a.element).toBe(first.video);
    const changes: Array<HTMLVideoElement | null> = [];
    a.onVideoChange((v) => changes.push(v));
    const buffering: boolean[] = [];
    a.onBuffering((b) => buffering.push(b));

    const second = makeVideo({ currentTime: 42 });
    areas.set(second.video, 1000);
    first.video.remove();
    document.body.append(second.video);
    await flush();
    expect(a.element).toBe(second.video);
    expect(changes).toEqual([second.video]);
    expect(a.getPosition()).toBe(42);

    // Events from the old element no longer count.
    first.fire('waiting');
    expect(buffering).toEqual([]);
    second.fire('waiting');
    expect(buffering).toEqual([true]);
  });

  it('reports no video when the page has none', async () => {
    const only = makeVideo();
    areas.set(only.video, 1000);
    document.body.append(only.video);
    const a = create();
    only.video.remove();
    await flush();
    expect(a.element).toBeNull();
    expect(a.isPaused()).toBe(true);
    expect(a.getPosition()).toBe(0);
    expect(await a.play()).toBe('ok');
  });
});

describe('buffering', () => {
  it('turns on with waiting and off with playing, canplay or pause', () => {
    const v = makeVideo();
    areas.set(v.video, 1000);
    document.body.append(v.video);
    const a = create();
    const seen: boolean[] = [];
    a.onBuffering((b) => seen.push(b));
    v.fire('waiting');
    expect(a.isBuffering()).toBe(true);
    v.fire('playing');
    v.fire('waiting');
    v.fire('canplay');
    v.fire('waiting');
    v.video.pause();
    expect(seen).toEqual([true, false, true, false, true, false]);
  });

  it('counts stalled as buffering only when no data is ready', () => {
    const v = makeVideo({ readyState: 4 });
    areas.set(v.video, 1000);
    document.body.append(v.video);
    const a = create();
    v.fire('stalled');
    expect(a.isBuffering()).toBe(false);
    v.state.readyState = 2;
    v.fire('stalled');
    expect(a.isBuffering()).toBe(true);
  });
});

describe('user actions', () => {
  function setup(requireInput: boolean) {
    const v = makeVideo({ currentTime: 100 });
    areas.set(v.video, 1000);
    document.body.append(v.video);
    const a = create({ requireInput });
    const actions: Array<{ kind: string; position: number }> = [];
    a.onUserAction((x) => actions.push(x));
    return { v, a, actions };
  }

  it('reports play, pause and seeks longer than a second', async () => {
    const { v, actions } = setup(false);
    await v.video.play();
    v.video.pause();
    v.fire('timeupdate');
    v.state.seeking = true;
    v.fire('seeking');
    v.state.currentTime = 160;
    v.state.seeking = false;
    v.fire('seeked');
    expect(actions).toEqual([
      { kind: 'play', position: 100 },
      { kind: 'pause', position: 100 },
      { kind: 'seek', position: 160 },
    ]);
  });

  it('ignores small seeks the service makes itself', () => {
    const { v, actions } = setup(false);
    v.fire('timeupdate');
    v.fire('seeking');
    v.state.currentTime = 100.4;
    v.fire('seeked');
    expect(actions).toEqual([]);
  });

  it('does not report the pause that comes with the end of the film', () => {
    const { v, a, actions } = setup(false);
    let ended = 0;
    a.onEnded(() => ended++);
    v.state.ended = true;
    v.video.pause();
    v.fire('ended');
    expect(actions).toEqual([]);
    expect(ended).toBe(1);
  });

  it('reports only after the member touched the page when input is required', async () => {
    const { v, actions } = setup(true);
    // The service's own autoplay, with no input from the member.
    await v.video.play();
    expect(actions).toEqual([]);
    document.dispatchEvent(new Event('pointerdown'));
    v.video.pause();
    expect(actions).toEqual([{ kind: 'pause', position: 100 }]);
    clock += INPUT_WINDOW_MS + 1;
    await v.video.play();
    expect(actions).toHaveLength(1);
  });
});

describe('capabilities', () => {
  function setup(caps: Partial<typeof S1_RESULTS.netflix.capabilities>) {
    const v = makeVideo({ currentTime: 10 });
    areas.set(v.video, 1000);
    document.body.append(v.video);
    return { v, a: create({ caps }) };
  }

  it('uses the DEFAULT values from S1 until the spike runs', () => {
    for (const source of ['netflix', 'prime', 'disney'] as const) {
      expect(S1_RESULTS[source].status).toBe('DEFAULT');
      expect(S1_RESULTS[source].capabilities).toEqual({ seek: false, fineRate: false, volume: true, seekLatencySec: 0.5 });
    }
  });

  it('never seeks while seek is off, and seeks by currentTime once it is on', async () => {
    const off = setup({ seek: false });
    await off.a.seek(300);
    expect(off.v.state.currentTime).toBe(10);
    off.a.destroy();
    document.body.replaceChildren();
    const on = setup({ seek: true });
    await on.a.seek(300);
    expect(on.v.state.currentTime).toBe(300);
    await on.a.seek(-5);
    expect(on.v.state.currentTime).toBe(0);
  });

  it('sets only the normal rate without fine rates', () => {
    const { v, a } = setup({ fineRate: false });
    a.setRate(1.05);
    expect(v.state.playbackRate).toBe(1);
    v.state.playbackRate = 1.5;
    a.setRate(1);
    expect(v.state.playbackRate).toBe(1);
  });

  it('nudges the rate with fine rates', () => {
    const { v, a } = setup({ fineRate: true });
    a.setRate(0.95);
    expect(v.state.playbackRate).toBe(0.95);
    expect(a.getRate()).toBe(0.95);
  });

  it('sets volume only when volume is on, clamped to 0 to 1', () => {
    const off = setup({ volume: false });
    off.a.setVolume(0.3);
    expect(off.v.state.volume).toBe(1);
    off.a.destroy();
    document.body.replaceChildren();
    const on = setup({ volume: true });
    on.a.setVolume(0.3);
    expect(on.a.getVolume()).toBe(0.3);
    on.a.setVolume(4);
    expect(on.v.state.volume).toBe(1);
  });
});

describe('play', () => {
  it('reports blocked only for the browser autoplay refusal', async () => {
    const v = makeVideo({ playError: { name: 'NotAllowedError' } });
    areas.set(v.video, 1000);
    document.body.append(v.video);
    const a = create();
    expect(await a.play()).toBe('blocked');
    v.state.playError = { name: 'AbortError' };
    expect(await a.play()).toBe('ok');
    v.state.playError = null;
    expect(await a.play()).toBe('ok');
    expect(a.isPaused()).toBe(false);
    await a.pause();
    expect(a.isPaused()).toBe(true);
  });

  it('reports duration only when it is known', () => {
    const v = makeVideo({ duration: Number.NaN });
    areas.set(v.video, 1000);
    document.body.append(v.video);
    const a = create();
    expect(a.getDuration()).toBeNull();
    v.state.duration = 3600;
    expect(a.getDuration()).toBe(3600);
  });
});

describe('destroy', () => {
  it('stops following the page', async () => {
    const v = makeVideo();
    areas.set(v.video, 1000);
    document.body.append(v.video);
    const a = create();
    const seen: boolean[] = [];
    a.onBuffering((b) => seen.push(b));
    a.destroy();
    v.fire('waiting');
    const other = makeVideo();
    areas.set(other.video, 5000);
    document.body.append(other.video);
    await flush();
    expect(seen).toEqual([]);
    expect(a.element).toBeNull();
  });
});
