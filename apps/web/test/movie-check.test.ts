import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { allowedCodecs, webmCodecs } from '../lib/movie-check';
describe('Movie compatibility', () => {
  it('accepts only supported codec combinations', () => {
    expect(allowedCodecs('video/mp4', ['avc1.42c01e'], ['mp4a.40.2'])).toBe(true);
    expect(allowedCodecs('video/mp4', ['hvc1.1.6.L93'], ['mp4a.40.2'])).toBe(false);
    expect(allowedCodecs('video/mp4', ['avc1.42c01e'], ['ac-3'])).toBe(false);
    expect(allowedCodecs('video/mp4', [], ['mp4a.40.2'])).toBe(false);
    expect(allowedCodecs('video/webm', ['V_VP9'], ['A_OPUS'])).toBe(true);
    expect(allowedCodecs('video/webm', ['V_AV1'], ['A_VORBIS'])).toBe(false);
  });
  it('parses actual WebM track headers', () => {
    const bytes = readFileSync(new URL('./fixtures/playable.webm', import.meta.url));
    expect(webmCodecs(bytes)).toEqual({ video: ['V_VP9'], audio: ['A_OPUS'] });
  });
  it('refuses truncated and non-WebM content', () => {
    expect(() => webmCodecs(new Uint8Array([0, 0, 0]))).toThrow();
    expect(() => webmCodecs(readFileSync(new URL('./fixtures/playable.mp4', import.meta.url)))).toThrow();
  });
});
