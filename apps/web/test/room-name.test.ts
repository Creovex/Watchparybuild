import { describe, expect, it } from 'vitest';
import { defaultRoomName } from '../lib/room-name';

describe('defaultRoomName', () => {
  it('uses the first word of the display name', () => {
    expect(defaultRoomName('James Akintunde')).toBe("James's room");
    expect(defaultRoomName('  Oluwatobi   James ')).toBe("Oluwatobi's room");
  });

  it('falls back when there is no name', () => {
    expect(defaultRoomName(null)).toBe('My room');
    expect(defaultRoomName('   ')).toBe('My room');
  });

  it('stays within the 80 character limit', () => {
    expect(defaultRoomName('x'.repeat(100)).length).toBe(80);
  });
});
