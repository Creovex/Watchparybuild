import { describe, expect, it } from 'vitest';
import type { MessageRow } from '@watchparty/sync-core';
import { joinNames, systemText } from '../src/room/system-text';
import { Store } from '../src/room/store';
import { initials } from '../src/primitives';

const A = '6f1a5b3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const B = '7a2b6c4d-2d3e-4f60-9b0c-1d2e3f4a5b6c';
const names: Record<string, string> = { [A]: 'Ana', [B]: 'Jamie' };
const nameOf = (id: string | null) => (id ? names[id] ?? 'Someone' : 'Deleted user');

function system(code: MessageRow['system_code'], body: unknown): MessageRow {
  return {
    id: A,
    room_id: B,
    user_id: null,
    kind: 'system',
    body: JSON.stringify(body),
    system_code: code,
    position_sec: null,
    created_at: '2026-10-11T01:00:00Z',
    deleted_at: null,
  };
}

describe('system message sentences', () => {
  it('builds each sentence from its code', () => {
    expect(systemText(system('joined', { user_id: A }), nameOf)).toBe('Ana joined');
    expect(systemText(system('left', { user_id: B }), nameOf)).toBe('Jamie left');
    expect(systemText(system('host_changed', { user_id: B }), nameOf)).toBe('Jamie is now the host');
    expect(systemText(system('cue_ready', { user_id: A, position_sec: 3725 }), nameOf)).toBe('Ana is ready at 1:02:05');
    expect(systemText(system('waiting_for', { user_ids: [A, B] }), nameOf)).toBe('Waiting for Ana and Jamie to catch up');
  });

  it('names a deleted account and survives a broken body', () => {
    expect(systemText(system('joined', {}), nameOf)).toBe('Deleted user joined');
    const broken = { ...system('left', {}), body: 'not json' };
    expect(systemText(broken, nameOf)).toBe('Deleted user left');
    expect(systemText(system(null, {}), nameOf)).toBe('');
  });

  it('joins names in plain English', () => {
    expect(joinNames([])).toBe('someone');
    expect(joinNames(['Ana'])).toBe('Ana');
    expect(joinNames(['Ana', 'Jamie', 'Sam'])).toBe('Ana, Jamie and Sam');
  });
});

describe('store', () => {
  it('replaces the snapshot and notifies subscribers', () => {
    const store = new Store({ a: 1, b: 2 });
    const seen: number[] = [];
    const off = store.subscribe(() => seen.push(store.get().a));
    store.set({ a: 5 });
    store.set((s) => ({ b: s.a + 1 }));
    expect(store.get()).toEqual({ a: 5, b: 6 });
    off();
    store.set({ a: 9 });
    expect(seen).toEqual([5, 5]);
  });
});

describe('initials', () => {
  it('takes the first and last initials', () => {
    expect(initials('Ana Lindqvist')).toBe('AL');
    expect(initials('  sam ')).toBe('S');
    expect(initials('Jean Luc Picard')).toBe('JP');
    expect(initials('')).toBe('?');
  });
});
