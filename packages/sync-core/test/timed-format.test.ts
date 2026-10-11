import { describe, expect, it } from 'vitest';
import { passedComments } from '../src/timed';
import { describeOffset, formatTimecode, parseTimecode } from '../src/format';

describe('timed comments', () => {
  const comments = [
    { id: 'a', position_sec: 10 },
    { id: 'b', position_sec: 10.5 },
    { id: 'c', position_sec: 20 },
    { id: 'd', position_sec: null },
  ];

  it('returns comments passed during normal playback', () => {
    expect(passedComments(9.8, 10.2, comments).map((c) => c.id)).toEqual(['a']);
    expect(passedComments(10, 10.6, comments).map((c) => c.id)).toEqual(['b']);
  });

  it('ignores seeks and backwards jumps', () => {
    expect(passedComments(5, 25, comments)).toEqual([]);
    expect(passedComments(12, 9, comments)).toEqual([]);
    expect(passedComments(10, 10, comments)).toEqual([]);
  });
});

describe('timecodes', () => {
  it('formats minutes and hours', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(65.9)).toBe('1:05');
    expect(formatTimecode(3725)).toBe('1:02:05');
    expect(formatTimecode(-4)).toBe('0:00');
    expect(formatTimecode(Number.NaN)).toBe('0:00');
  });

  it('parses typed times', () => {
    expect(parseTimecode('1:02:05')).toBe(3725);
    expect(parseTimecode('2:03')).toBe(123);
    expect(parseTimecode(' 90 ')).toBe(90);
    expect(parseTimecode('1:75')).toBeNull();
    expect(parseTimecode('abc')).toBeNull();
    expect(parseTimecode('')).toBeNull();
  });

  it('describes a cue sync offset', () => {
    expect(describeOffset(0.3)).toBe("You're in sync");
    expect(describeOffset(1)).toBe("You're about 1 second ahead");
    expect(describeOffset(-12.4)).toBe("You're about 12 seconds behind");
  });
});
