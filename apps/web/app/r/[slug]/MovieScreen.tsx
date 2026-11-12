'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenStage = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function MovieScreen({ children }: { children: ReactNode }) {
  const stage = useRef<FullscreenStage>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [native, setNative] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const active = expanded || native;

  useEffect(() => {
    const doc = document as FullscreenDocument;
    const changed = () => {
      const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
      const entered = Boolean(element && stage.current?.contains(element));
      setNative(entered);
      if (entered) { setExpanded(false); setNotice(''); }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Prevent keyboard focus from moving into the room hidden behind expanded video.
    const outside: [HTMLElement, boolean][] = [];
    let branch: HTMLElement | null = stage.current;
    while (branch?.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          outside.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); setNotice(''); }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = oldOverflow;
      for (const [element, inert] of outside) element.inert = inert;
      document.removeEventListener('keydown', escape);
      button.current?.focus({ preventScroll: true });
    };
  }, [expanded]);

  useEffect(() => {
    if (!native) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const doc = document as FullscreenDocument;
      const exit = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
      void Promise.resolve(exit).then(() => {
        setNative(false);
        button.current?.focus({ preventScroll: true });
      }).catch(() => {});
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [native]);

  async function fullscreen() {
    const element = stage.current;
    if (!element || pending) return;
    setNotice('');
    if (expanded) { setExpanded(false); return; }
    const doc = document as FullscreenDocument;
    const current = doc.fullscreenElement ?? doc.webkitFullscreenElement;
    setPending(true);
    try {
      if (current && element.contains(current)) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
        setNative(false);
        button.current?.focus({ preventScroll: true });
        return;
      }
      try {
        if (element.requestFullscreen && document.fullscreenEnabled !== false)
          await element.requestFullscreen();
        else if (element.webkitRequestFullscreen) await element.webkitRequestFullscreen();
        else throw new Error('Fullscreen unavailable');
        if (!(doc.fullscreenElement ?? doc.webkitFullscreenElement))
          throw new Error('Fullscreen did not open');
        setNative(true);
      } catch {
        // Keep the same player mounted so expanding never reloads or desynchronizes it.
        setExpanded(true);
        setNotice('Browser fullscreen is unavailable. The video fills this window instead.');
      }
    } catch {
      setNotice('Use Escape or your browser’s fullscreen control to exit.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={stage} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? 'Expanded movie' : undefined} data-expanded={active} data-testid="movie-screen"
      className={`movie-screen flex min-h-0 flex-col justify-center bg-black ${expanded ? 'fixed inset-0 z-[100] h-dvh w-screen' : ''}`}>
      <div className="flex shrink-0 items-center justify-end gap-3 px-3 py-1">
        {notice ? <p className="mr-auto text-sm text-muted" role="status">{notice}</p> : null}
        <button ref={button} className="min-h-11 shrink-0 px-4 text-sm underline" disabled={pending}
          aria-pressed={active} onClick={() => void fullscreen()}>
          {active ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div className="movie-screen-content flex min-h-0 flex-col">{children}</div>
    </div>
  );
}
