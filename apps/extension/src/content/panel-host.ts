// Docks the room panel on the right of the streaming page: an iframe of the extension's panel page,
// inside a closed shadow root so the page's styles cannot reach it, with a tab on its left edge to
// collapse and expand it. It overlays the page rather than resizing it, so nothing on the service's
// page is squeezed. Styles are set through element style properties, which a page's Content
// Security Policy does not block.

export const PANEL_WIDTH = 360;
const TAB_WIDTH = 28;
const TOP_LAYER = '2147483646';

const COLORS = { ink: '#0f0d0c', surface: '#2a241f', line: '#6b5d50', text: '#f4eee6', amber: '#ffb84d' };

function setStyles(el: HTMLElement | SVGElement, styles: Record<string, string>): void {
  for (const [name, value] of Object.entries(styles)) el.style.setProperty(name, value, 'important');
}

function chevron(doc: Document, pointsRight: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', pointsRight ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

export class PanelHost {
  private host: HTMLDivElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private toggle: HTMLButtonElement | null = null;
  private wrapper: HTMLDivElement | null = null;
  private collapsedState = false;

  constructor(
    private readonly doc: Document,
    private readonly panelUrl: string,
  ) {}

  get mounted(): boolean {
    return this.host !== null && this.host.isConnected;
  }

  get collapsed(): boolean {
    return this.collapsedState;
  }

  mount(): void {
    if (this.mounted) return;
    const doc = this.doc;
    const host = doc.createElement('div');
    host.setAttribute('data-watchparty', 'panel');
    setStyles(host, {
      position: 'fixed',
      top: '0',
      right: '0',
      height: '100vh',
      width: '0',
      overflow: 'visible',
      'z-index': TOP_LAYER,
      margin: '0',
      padding: '0',
      border: '0',
    });
    const root = host.attachShadow({ mode: 'closed' });

    const wrapper = doc.createElement('div');
    setStyles(wrapper, {
      position: 'absolute',
      top: '0',
      right: '0',
      height: '100vh',
      width: `${PANEL_WIDTH}px`,
      display: 'block',
      transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      transform: 'translateX(0)',
    });

    const frame = doc.createElement('iframe');
    frame.src = this.panelUrl;
    frame.title = 'Watch party room';
    frame.setAttribute('allow', 'microphone; camera; autoplay');
    setStyles(frame, {
      width: `${PANEL_WIDTH}px`,
      height: '100vh',
      border: '0',
      'border-left': `1px solid ${COLORS.line}`,
      background: COLORS.ink,
      'color-scheme': 'dark',
      display: 'block',
    });

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    setStyles(toggle, {
      position: 'absolute',
      top: '50%',
      left: `-${TAB_WIDTH}px`,
      width: `${TAB_WIDTH}px`,
      height: '64px',
      transform: 'translateY(-50%)',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      background: COLORS.surface,
      color: COLORS.text,
      border: `1px solid ${COLORS.line}`,
      'border-right': '0',
      'border-radius': '10px 0 0 10px',
      cursor: 'pointer',
      padding: '0',
      outline: 'none',
    });
    toggle.addEventListener('focus', () => setStyles(toggle, { 'box-shadow': `0 0 0 2px ${COLORS.amber}` }));
    toggle.addEventListener('blur', () => setStyles(toggle, { 'box-shadow': 'none' }));
    toggle.addEventListener('click', () => this.setCollapsed(!this.collapsedState));

    wrapper.append(toggle, frame);
    root.append(wrapper);
    doc.documentElement.append(host);
    this.host = host;
    this.frame = frame;
    this.toggle = toggle;
    this.wrapper = wrapper;
    this.render();
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsedState = collapsed;
    this.render();
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.frame = null;
    this.toggle = null;
    this.wrapper = null;
  }

  private render(): void {
    if (!this.wrapper || !this.toggle || !this.frame) return;
    const collapsed = this.collapsedState;
    setStyles(this.wrapper, { transform: collapsed ? `translateX(${PANEL_WIDTH}px)` : 'translateX(0)' });
    this.toggle.replaceChildren(chevron(this.doc, !collapsed));
    const label = collapsed ? 'Show the room panel' : 'Hide the room panel';
    this.toggle.setAttribute('aria-label', label);
    this.toggle.title = label;
    this.toggle.setAttribute('aria-expanded', String(!collapsed));
    // A collapsed panel keeps running (voice, chat) but leaves the tab order.
    this.frame.tabIndex = collapsed ? -1 : 0;
  }
}
