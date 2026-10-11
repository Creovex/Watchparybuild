import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/big-shoulders';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/jetbrains-mono';
import { ToastProvider } from '@watchparty/ui';
import { App } from './App';
import { PanelPort } from './port';
import { PanelSession } from './session';
import './panel.css';

// The panel page, loaded in an iframe the content script docks on the right of the streaming tab.

const port = new PanelPort();
const session = new PanelSession({
  port,
  storage: {
    get: async (key) => (await chrome.storage.session.get(key))[key],
    set: (items) => chrome.storage.session.set(items),
  },
  log: (event, detail) => console.warn(`[room] ${event}`, detail),
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>
        <App session={session} />
      </ToastProvider>
    </StrictMode>,
  );
}
