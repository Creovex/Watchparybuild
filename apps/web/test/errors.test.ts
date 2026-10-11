import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SILENT_CODES } from '@watchparty/sync-core';
import { VOICE_ONLY_ERROR_CODES } from '@watchparty/voice';
import { ERROR_SENTENCES, errorSentence, isSilent, VOICE_SENTENCES, voiceErrorSentence } from '../lib/errors';

// Phase 7 check: every code an RPC or Edge Function can return has a sentence.
describe('error sentences', () => {
  it.each(ERROR_CODES.filter((c) => !SILENT_CODES.includes(c)))('has a sentence for %s', (code) => {
    const entry = ERROR_SENTENCES[code];
    expect(entry).toBeDefined();
    const text = typeof entry === 'function' ? entry({ roomCap: 3 }) : entry;
    expect(text.length).toBeGreaterThan(10);
    expect(text).toMatch(/[.!]$/);
    if (code.includes('_')) expect(text).not.toContain(code);
  });

  it.each([...VOICE_ONLY_ERROR_CODES])('has a voice sentence for %s', (code) => {
    expect(VOICE_SENTENCES[code]).toMatch(/[.!]$/);
    expect(voiceErrorSentence(code)).toBe(VOICE_SENTENCES[code]);
  });

  it('falls back to the shared sentences for voice errors that are RPC codes', () => {
    expect(voiceErrorSentence('voice_muted')).toBe('The host muted you.');
  });

  it('marks stale_seq and not_elected as silent', () => {
    expect(isSilent('stale_seq')).toBe(true);
    expect(isSilent('not_elected')).toBe(true);
    expect(isSilent('room_full')).toBe(false);
  });

  it('words room_full by the room cap', () => {
    expect(errorSentence('room_full', { roomCap: 3 })).toBe(
      'This room is full (3 of 3). Rooms of 10 come with paid plans, coming soon.',
    );
    expect(errorSentence('room_full', { roomCap: 10 })).toBe('This room is full (10 of 10).');
  });

  it('uses the bad_key sentence from the specification', () => {
    expect(errorSentence('bad_key')).toBe(
      'This private room link is missing its key or the key has changed. Ask the host for a new link.',
    );
  });

  it('never shows an unknown code', () => {
    expect(errorSentence('PGRST301 boom')).toBe(errorSentence('internal'));
    expect(errorSentence('stale_seq')).toBe(errorSentence('internal'));
  });
});
