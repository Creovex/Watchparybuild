import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Html5VideoAdapter } from '../lib/adapters/html5';
class Video extends EventTarget {
  controls = false; playsInline = false; preload = ''; className = ''; dataset = {};
  readyState = 4; paused = true; seeking = false; ended = false;
  currentTime = 0; duration = 100; playbackRate = 1; volume = 1;
  setAttribute = vi.fn(); removeAttribute = vi.fn(); load = vi.fn(); remove = vi.fn();
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
}
let video: Video;
let adapter: Html5VideoAdapter;
beforeEach(() => {
  video = new Video();
  vi.stubGlobal('navigator', { userAgent: 'Chrome', maxTouchPoints: 0 });
  vi.stubGlobal('document', { createElement: () => video });
  adapter = new Html5VideoAdapter({ replaceChildren: vi.fn() } as unknown as HTMLElement,
    async () => ({ url: '/movie', expires_at: new Date(Date.now() + 86400000).toISOString() }),
    () => ({ position: 0, playing: true }));
});
afterEach(() => { adapter.destroy(); vi.unstubAllGlobals(); });
describe('native movie events', () => {
  it('does not pause the room for a stalled download when playback has buffered data', () => {
    const changes = vi.fn(); adapter.onBuffering(changes);
    video.paused = false; video.readyState = 4;
    video.dispatchEvent(new Event('stalled'));
    expect(adapter.isBuffering()).toBe(false);
    expect(changes).not.toHaveBeenCalled();
  });
  it('clears actual buffering when readiness recovers during a room-wide pause', () => {
    video.paused = false; video.readyState = 2;
    video.dispatchEvent(new Event('waiting'));
    expect(adapter.isBuffering()).toBe(true);
    video.paused = true; video.readyState = 3;
    video.dispatchEvent(new Event('progress'));
    expect(adapter.isBuffering()).toBe(false);
  });
  it('sends a user seek as soon as it starts, before the new range finishes loading', () => {
    const action = vi.fn(); adapter.onUserAction(action);
    video.currentTime = 25; video.readyState = 1; video.seeking = true;
    video.dispatchEvent(new Event('seeking'));
    expect(action).toHaveBeenCalledWith({ kind: 'seek', position: 25 });
  });
  it('filters a programmatic seek but keeps the next nearby user seek', async () => {
    const action = vi.fn(); adapter.onUserAction(action);
    await adapter.seek(25);
    video.dispatchEvent(new Event('seeking'));
    expect(action).not.toHaveBeenCalled();
    video.currentTime = 25.2;
    video.dispatchEvent(new Event('seeking'));
    expect(action).toHaveBeenCalledWith({ kind: 'seek', position: 25.2 });
  });
  it('does not hide the browser video fullscreen control', () => {
    expect(video.setAttribute).toHaveBeenCalledWith('controlsList', 'nodownload noremoteplayback');
  });
});

it('does not report a new seek ready just because old frames are still buffered', async () => {
  await adapter.seek(5);
  video.seeking = true;
  video.dispatchEvent(new Event('progress'));
  expect(adapter.isBuffering()).toBe(true);
  video.seeking = false;
  video.dispatchEvent(new Event('seeked'));
  expect(adapter.isBuffering()).toBe(false);
});
