'use client';
import { useRef, type ReactNode } from 'react';
export function MovieScreen({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await stage.current?.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      await orientation.lock?.('landscape').catch(() => undefined);
    } catch {
      /* Native video fullscreen remains available where element fullscreen is unsupported. */
    }
  }
  return (
    <div
      ref={stage}
      className="flex min-h-0 flex-col justify-center bg-black [&:fullscreen]:h-dvh [&:fullscreen]:w-screen [&:fullscreen_[data-testid=player]]:!max-w-full"
    >
      <button className="min-h-11 self-end px-4 text-sm underline" onClick={() => void fullscreen()}>
        Fullscreen
      </button>
      {children}
    </div>
  );
}
