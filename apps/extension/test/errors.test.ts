import { describe, expect, it } from 'vitest';
import { ERROR_CODES, SILENT_CODES } from '@watchparty/sync-core';
import { VOICE_ONLY_ERROR_CODES } from '@watchparty/voice';
import * as web from '../../web/lib/errors';
import { ERROR_SENTENCES, errorSentence, VOICE_SENTENCES, voiceErrorSentence } from '../src/panel/errors';

// Both the web app and the panel re-export packages/ui/src/errors.ts; the last test guards that.

describe('panel error sentences', () => {
  it('has a sentence for every code that can be shown', () => {
    for (const code of ERROR_CODES) {
      if (SILENT_CODES.includes(code)) continue;
      const sentence = errorSentence(code, { roomCap: 3 });
      expect(sentence.length, code).toBeGreaterThan(0);
      // No raw code such as room_full reaches the screen.
      expect(sentence, code).not.toMatch(/[a-z]+_[a-z]+/);
    }
    for (const code of VOICE_ONLY_ERROR_CODES) expect(voiceErrorSentence(code).length).toBeGreaterThan(0);
  });

  it('turns unknown codes into the internal sentence', () => {
    expect(errorSentence('PGRST301 something broke')).toBe(errorSentence('internal'));
  });

  it('matches the web app word for word', () => {
    for (const code of ERROR_CODES) {
      for (const roomCap of [3, 10]) {
        expect(errorSentence(code, { roomCap }), code).toBe(web.errorSentence(code, { roomCap }));
      }
    }
    expect(Object.keys(ERROR_SENTENCES).sort()).toEqual(Object.keys(web.ERROR_SENTENCES).sort());
    expect(VOICE_SENTENCES).toEqual(web.VOICE_SENTENCES);
  });
});
