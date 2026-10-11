'use client';

import { useEffect } from 'react';

/**
 * Keeps the screen on while `active`. A phone that dims and locks halfway through a film drops voice
 * and falls out of sync. Browsers release the lock whenever the page is hidden, so it is asked for
 * again each time the page comes back. Where the browser has no wake lock, or refuses one (low power
 * mode), the screen simply sleeps as it always did.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;

    const acquire = async () => {
      if (stopped || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (stopped) await next.release();
        else lock = next;
      } catch {
        // Refused: the screen sleeps as usual.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
