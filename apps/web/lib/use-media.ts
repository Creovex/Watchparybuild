'use client';

import { useSyncExternalStore } from 'react';

/** Whether a media query matches, kept current as the window changes. False during server render. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const DESKTOP_QUERY = '(min-width: 1024px)';
/** Phones held sideways: the player fills the height and a narrow column sits beside it. */
export const PHONE_LANDSCAPE_QUERY = '(orientation: landscape) and (max-height: 500px)';
