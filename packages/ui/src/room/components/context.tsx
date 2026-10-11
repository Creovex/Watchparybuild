'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { RoomController } from '../controller';

const RoomContext = createContext<RoomController | null>(null);

export function RoomProvider({ controller, children }: { controller: RoomController; children: ReactNode }) {
  return <RoomContext.Provider value={controller}>{children}</RoomContext.Provider>;
}

export function useController(): RoomController {
  const controller = useContext(RoomContext);
  if (!controller) throw new Error('useController outside RoomProvider');
  return controller;
}
