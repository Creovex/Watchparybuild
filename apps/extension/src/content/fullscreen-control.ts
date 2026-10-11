import { REACTION_LABEL, REACTIONS, type ReactionEmoji } from '@watchparty/sync-core';
import type { VoiceIndicator } from '../shared/messages';

// A small floating control shown inside the service's full screen player, where the docked panel
// cannot be seen: the microphone, the count of chat messages that arrived during full screen, and
// reactions. It talks to the panel through the content script's port. Spike S2 confirms per service
// that it appears; when it cannot, the panel still works outside full screen.

export type FullscreenAction = { action: 'mic' } | { action: 'react'; emoji: ReactionEmoji };

const COLORS = { surface: 'rgba(23, 20, 18, 0.88)', line: '#6b5d50', text: '#f4eee6', amber: '#ffb84d', red: '#ff7a6b' };

function setStyles(el: HTMLElement, styles: Record<string, string>): void {
  for (const [name, value] of Object.entries(styles)) el.style.setProperty(name, value, 'important');
}

const MIC = 'M9 3h6v11H9zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7';
const MIC_OFF = 'M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 9.8 5.6M12 17.5V21M8.5 21h7M3.5 3.5l17 17';
const CHAT = 'M4.5 5.5h15v10h-9l-4 3.5v-3.5h-2z';
const SMILE = 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.5 14a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01';

export class FullscreenControl {
  private host: HTMLDivElement | null = null;
  private micButton: HTMLButtonElement | null = null;
  private chatButton: HTMLButtonElement | null = null;
  private tray: HTMLDivElement | null = null;
  private voice: VoiceIndicator = 'off';
  private unread = 0;

  constructor(
    private readonly doc: Document,
    private readonly onAction: (action: FullscreenAction) => void,
  ) {}

  get attached(): boolean {
    return this.host !== null && this.host.isConnected;
  }

  /** Places the control inside the element that is full screen. */
  attach(container: Element): void {
    this.detach();
    const doc = this.doc;
    const host = doc.createElement('div');
    host.setAttribute('data-watchparty', 'fullscreen-control');
    setStyles(host, { position: 'absolute', top: '16px', right: '16px', 'z-index': '2147483646', margin: '0', padding: '0' });
    const root = host.attachShadow({ mode: 'closed' });

    const bar = doc.createElement('div');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Watch party');
    setStyles(bar, {
      display: 'flex',
      gap: '4px',
      padding: '4px',
      background: COLORS.surface,
      border: `1px solid ${COLORS.line}`,
      'border-radius': '12px',
      'font-family': 'system-ui, sans-serif',
      'align-items': 'center',
    });

    this.micButton = this.button(MIC, 'Microphone', () => this.onAction({ action: 'mic' }));
    this.chatButton = this.button(CHAT, 'New chat messages', () => {
      // Chat lives in the panel, which shows once full screen ends.
      void doc.exitFullscreen?.().catch(() => undefined);
    });
    const reactButton = this.button(SMILE, 'React', () => {
      if (!this.tray) return;
      const open = this.tray.style.getPropertyValue('display') !== 'none';
      setStyles(this.tray, { display: open ? 'none' : 'flex' });
      reactButton.setAttribute('aria-expanded', String(!open));
    });
    reactButton.setAttribute('aria-expanded', 'false');

    const tray = doc.createElement('div');
    tray.setAttribute('role', 'group');
    tray.setAttribute('aria-label', 'Reactions');
    setStyles(tray, {
      display: 'none',
      gap: '2px',
      'margin-top': '6px',
      padding: '4px',
      background: COLORS.surface,
      border: `1px solid ${COLORS.line}`,
      'border-radius': '12px',
    });
    for (const emoji of REACTIONS) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = emoji;
      b.setAttribute('aria-label', REACTION_LABEL[emoji]);
      b.title = REACTION_LABEL[emoji];
      setStyles(b, {
        width: '44px',
        height: '44px',
        'font-size': '22px',
        background: 'transparent',
        border: '0',
        'border-radius': '8px',
        cursor: 'pointer',
        padding: '0',
      });
      b.addEventListener('click', () => this.onAction({ action: 'react', emoji }));
      tray.append(b);
    }

    bar.append(this.micButton, this.chatButton, reactButton);
    const column = doc.createElement('div');
    setStyles(column, { display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-end' });
    column.append(bar, tray);
    root.append(column);
    container.append(host);
    this.host = host;
    this.tray = tray;
    this.render();
  }

  detach(): void {
    this.host?.remove();
    this.host = null;
    this.micButton = null;
    this.chatButton = null;
    this.tray = null;
  }

  update(voice: VoiceIndicator, unread: number): void {
    this.voice = voice;
    this.unread = unread;
    this.render();
  }

  private button(path: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    setStyles(b, {
      display: 'inline-flex',
      'align-items': 'center',
      gap: '4px',
      'min-width': '44px',
      height: '44px',
      padding: '0 10px',
      background: 'transparent',
      color: COLORS.text,
      border: '0',
      'border-radius': '8px',
      cursor: 'pointer',
      'font-size': '14px',
      'font-weight': '600',
    });
    b.append(this.icon(path));
    b.addEventListener('click', onClick);
    return b;
  }

  private icon(path: string): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = this.doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    const p = this.doc.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.75');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
    return svg;
  }

  private render(): void {
    if (this.micButton) {
      const voice = this.voice;
      const label =
        voice === 'live' ? 'Mute' : voice === 'muted' ? 'Unmute' : voice === 'host_muted' ? 'Muted by host' : 'Join voice in the panel';
      this.micButton.replaceChildren(this.icon(voice === 'live' ? MIC : MIC_OFF));
      this.micButton.setAttribute('aria-label', label);
      this.micButton.title = label;
      this.micButton.disabled = voice === 'off' || voice === 'host_muted';
      setStyles(this.micButton, {
        color: voice === 'live' ? COLORS.amber : voice === 'off' ? COLORS.line : COLORS.red,
        opacity: this.micButton.disabled ? '0.7' : '1',
      });
    }
    if (this.chatButton) {
      const label = this.unread === 1 ? '1 new message' : `${this.unread} new messages`;
      this.chatButton.replaceChildren(this.icon(CHAT));
      if (this.unread > 0) {
        const count = this.doc.createElement('span');
        count.textContent = this.unread > 99 ? '99+' : String(this.unread);
        setStyles(count, { color: COLORS.amber, 'font-variant-numeric': 'tabular-nums' });
        this.chatButton.append(count);
      }
      this.chatButton.setAttribute('aria-label', `${label}. Leave full screen to read them.`);
      this.chatButton.title = label;
    }
  }
}
