import { describe, expect, it } from 'vitest';
import { parseRoomLink } from '../lib/room-link';

const SLUG = 'Ab3_x-9QzK';
const KEY = 'k3Y_with-22_chars_long';

describe('parseRoomLink', () => {
  it('reads a private room link and keeps its join key', () => {
    expect(parseRoomLink(`https://synvello.vercel.app/r/${SLUG}#k=${KEY}`)).toEqual({ ok: true, path: `/r/${SLUG}#k=${KEY}` });
  });

  it('reads a public room link', () => {
    expect(parseRoomLink(`https://synvello.vercel.app/r/${SLUG}`)).toEqual({ ok: true, path: `/r/${SLUG}` });
  });

  it('reads a link pasted without https and with spaces around it', () => {
    expect(parseRoomLink(`  synvello.vercel.app/r/${SLUG}/#k=${KEY} \n`)).toEqual({ ok: true, path: `/r/${SLUG}#k=${KEY}` });
  });

  it('reads a bare room code', () => {
    expect(parseRoomLink(SLUG)).toEqual({ ok: true, path: `/r/${SLUG}` });
  });

  it('always returns a path on this site, whatever host was pasted', () => {
    const result = parseRoomLink(`https://evil.example/r/${SLUG}#k=${KEY}`);
    expect(result).toEqual({ ok: true, path: `/r/${SLUG}#k=${KEY}` });
  });

  it.each([
    '',
    '   ',
    'hello there',
    'https://synvello.vercel.app/home',
    `https://synvello.vercel.app/r/${SLUG}/extra`,
    'https://synvello.vercel.app/r/short',
    `https://synvello.vercel.app/r/${SLUG}#k=not-a-key`,
    `https://synvello.vercel.app/r/${SLUG}#k=${KEY}<script>`,
    'javascript:alert(1)',
  ])('refuses %j', (input) => {
    expect(parseRoomLink(input)).toEqual({ ok: false });
  });
});
