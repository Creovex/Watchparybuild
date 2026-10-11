'use client';

import { useEffect, useState } from 'react';
import { Button, Notice } from '@watchparty/ui';
import { isIOS } from '@/lib/adapters/youtube';
import { APP_NAME } from '@/lib/env';

const DISMISSED_KEY = 'watchparty:tip:install';

/** Chrome's install prompt event. It is not in the DOM type library. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

function runningAsApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Suggests adding the app to the home screen, once, until dismissed. iPhone Safari has no install
 * prompt, so it gets the steps; Chrome and Edge get their own install button.
 */
export function InstallHint() {
  const [mode, setMode] = useState<'ios' | 'prompt' | null>(null);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // Storage refused: show the hint; it costs one tap to close.
    }
    if (dismissed || runningAsApp()) return;
    if (isIOS()) {
      setMode('ios');
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setMode('prompt');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Storage refused: the hint comes back next visit.
    }
    setMode(null);
  };

  return (
    <Notice
      title={`Put ${APP_NAME} on your home screen`}
      action={
        <div className="flex flex-wrap gap-2">
          {mode === 'prompt' && promptEvent ? (
            <Button
              variant="primary"
              onClick={() => {
                void promptEvent.prompt().finally(dismiss);
              }}
            >
              Install
            </Button>
          ) : null}
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      }
    >
      {mode === 'ios'
        ? 'Tap the Share button, then Add to Home Screen. It opens full screen like an app. Sign in once more inside it, and join rooms by pasting their link on this page.'
        : 'Install it as an app so it opens in its own window, without the browser around it.'}
    </Notice>
  );
}
