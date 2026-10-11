import { describe, expect, it } from 'vitest';
import { allWatchPages, isWatchPage, matchPatternToRegExp, sourceForHost, titleKey } from '../src/shared/services';

describe('services', () => {
  it('maps hosts to paid sources', () => {
    expect(sourceForHost('www.netflix.com')).toBe('netflix');
    expect(sourceForHost('netflix.com')).toBe('netflix');
    expect(sourceForHost('www.primevideo.com')).toBe('prime');
    expect(sourceForHost('www.amazon.co.uk')).toBe('prime');
    expect(sourceForHost('www.disneyplus.com')).toBe('disney');
    expect(sourceForHost('www.youtube.com')).toBeNull();
    expect(sourceForHost('netflix.com.evil.example')).toBeNull();
  });

  it('matches only watch pages', () => {
    expect(isWatchPage('https://www.netflix.com/watch/81234567?trackId=1')).toBe(true);
    expect(isWatchPage('https://www.netflix.com/browse')).toBe(false);
    expect(isWatchPage('https://www.netflix.com/title/80100172')).toBe(false);
    expect(isWatchPage('https://www.primevideo.com/detail/0ABCDEF/')).toBe(true);
    expect(isWatchPage('https://www.amazon.de/gp/video/detail/B0ABCDEFGH')).toBe(true);
    expect(isWatchPage('https://www.amazon.com/dp/B0ABCDEFGH')).toBe(false);
    expect(isWatchPage('https://www.disneyplus.com/video/5a6b-77')).toBe(true);
    expect(isWatchPage('https://www.disneyplus.com/en-gb/play/5a6b-77')).toBe(true);
    expect(isWatchPage('https://www.disneyplus.com/home')).toBe(false);
    expect(isWatchPage('https://evil.example/https://www.netflix.com/watch/1')).toBe(false);
  });

  it('turns match patterns into anchored expressions', () => {
    const re = matchPatternToRegExp('https://www.netflix.com/watch/*');
    expect(re.test('https://www.netflix.com/watch/1')).toBe(true);
    expect(re.test('https://wwwxnetflix.com/watch/1')).toBe(false);
    expect(allWatchPages().every((p) => p.startsWith('https://www.'))).toBe(true);
  });

  it('names titles so tracking parameters do not matter', () => {
    expect(titleKey('netflix', 'https://www.netflix.com/watch/81234567?trackId=14170286&tctx=1')).toBe('netflix:81234567');
    expect(titleKey('netflix', 'https://www.netflix.com/watch/81234567')).toBe(
      titleKey('netflix', 'https://netflix.com/watch/81234567#t=1'),
    );
    expect(titleKey('prime', 'https://www.primevideo.com/detail/0ABCDEF/ref=atv_hm?autoplay=1')).toBe('prime:0ABCDEF');
    expect(titleKey('prime', 'https://www.amazon.com/gp/video/detail/B0ABCDEFGH/')).toBe('prime:B0ABCDEFGH');
    expect(titleKey('disney', 'https://www.disneyplus.com/en-gb/play/5a6b-77')).toBe('disney:5a6b-77');
    expect(titleKey('disney', 'https://www.disneyplus.com/video/5a6b-77')).toBe('disney:5a6b-77');
    expect(titleKey('netflix', 'https://www.netflix.com/browse')).toBeNull();
    expect(titleKey('netflix', 'https://www.primevideo.com/detail/X')).toBeNull();
    expect(titleKey('netflix', null)).toBeNull();
    expect(titleKey('netflix', 'not a url')).toBeNull();
  });
});
