'use client';

// The join key travels in the address fragment (#k=...), which browsers never send to servers. The
// room page moves it into sessionStorage and strips it from the address bar, so it survives the
// Google sign in redirect without staying visible or in history.

const storageKey = (slug: string) => `watchparty:key:${slug}`;

export function captureJoinKey(slug: string): void {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;
  const key = new URLSearchParams(hash).get('k');
  if (key) {
    try {
      sessionStorage.setItem(storageKey(slug), key);
    } catch {
      // Private browsing can refuse storage; the key is then only good for this page load.
      memoryKeys.set(slug, key);
    }
  }
  history.replaceState(history.state, '', `${window.location.pathname}${window.location.search}`);
}

const memoryKeys = new Map<string, string>();

export function readJoinKey(slug: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(slug)) ?? memoryKeys.get(slug) ?? null;
  } catch {
    return memoryKeys.get(slug) ?? null;
  }
}
