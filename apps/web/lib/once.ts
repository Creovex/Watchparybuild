'use client';

/** A tip shown once per browser. Storage can be refused (private windows); the tip then shows again. */
export function seenOnce(key: string): boolean {
  try {
    if (localStorage.getItem(`watchparty:tip:${key}`)) return true;
    localStorage.setItem(`watchparty:tip:${key}`, '1');
  } catch {
    return false;
  }
  return false;
}
