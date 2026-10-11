import { describe, expect, it } from 'vitest';
import { contentUrl, parseContentRef, parsePaidRef, parseYouTubeRef, SOURCE_LABEL } from '../src/content-ref';

describe('YouTube content references', () => {
  it.each([
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/aBcDeFgHiJk', 'aBcDeFgHiJk'],
    ['  dQw4w9WgXcQ  ', 'dQw4w9WgXcQ'],
  ])('accepts %s', (input, ref) => {
    expect(parseYouTubeRef(input)).toEqual({ ok: true, ref });
  });

  it('refuses live streams with their own reason', () => {
    expect(parseYouTubeRef('https://www.youtube.com/live/dQw4w9WgXcQ')).toEqual({ ok: false, reason: 'live_stream' });
  });

  it.each(['', '   '])('reports empty input', (input) => {
    expect(parseYouTubeRef(input)).toEqual({ ok: false, reason: 'empty' });
  });

  it.each([
    'https://vimeo.com/12345',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/channel/UC123',
    'https://youtu.be/',
    'not a link at all',
    'http://[bad',
  ])('refuses %s', (input) => {
    expect(parseYouTubeRef(input).ok).toBe(false);
  });
});

describe('paid source content references', () => {
  it.each([
    ['netflix', 'https://www.netflix.com/watch/81234567?trackId=1'],
    ['netflix', 'https://netflix.com/watch/81234567'],
    ['prime', 'https://www.primevideo.com/detail/0ABC'],
    ['prime', 'https://www.amazon.co.uk/gp/video/detail/B0ABC'],
    ['prime', 'https://amazon.de/gp/video/detail/B0ABC'],
    ['disney', 'https://www.disneyplus.com/video/abc-123'],
  ] as const)('accepts %s %s', (source, input) => {
    const result = parsePaidRef(source, input);
    expect(result.ok).toBe(true);
  });

  it('drops the fragment', () => {
    expect(parsePaidRef('netflix', 'https://www.netflix.com/watch/1#x')).toEqual({
      ok: true,
      ref: 'https://www.netflix.com/watch/1',
    });
  });

  it.each([
    ['netflix', 'http://www.netflix.com/watch/1'],
    ['netflix', 'https://evil-netflix.com/watch/1'],
    ['netflix', 'https://netflix.com.evil.io/watch/1'],
    ['prime', 'https://www.amazon.fr/gp/video/detail/B0ABC'],
    ['disney', 'https://www.disneyplus.co/video/1'],
    ['disney', 'disneyplus.com/video/1'],
    ['disney', ''],
  ] as const)('refuses %s %s', (source, input) => {
    expect(parsePaidRef(source, input).ok).toBe(false);
  });

  it('routes by source', () => {
    expect(parseContentRef('youtube', 'dQw4w9WgXcQ').ok).toBe(true);
    expect(parseContentRef('netflix', 'dQw4w9WgXcQ').ok).toBe(false);
  });

  it('builds the address that opens a reference', () => {
    expect(contentUrl('youtube', 'dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(contentUrl('netflix', 'https://www.netflix.com/watch/1')).toBe('https://www.netflix.com/watch/1');
    expect(SOURCE_LABEL.disney).toBe('Disney+');
  });
});
