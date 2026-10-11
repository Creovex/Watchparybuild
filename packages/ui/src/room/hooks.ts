'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RoomController, RoomSnapshot } from './controller';

export function useRoom(controller: RoomController): RoomSnapshot {
  return useSyncExternalStore(controller.store.subscribe, controller.store.get, controller.store.get);
}

/** Re-renders every `ms` so values derived from the clock (expected position) stay current. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
