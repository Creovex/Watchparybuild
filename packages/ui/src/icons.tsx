import type { SVGProps } from 'react';

// Icons drawn for this app on one 24 pixel grid, 1.75 stroke, round caps and joins. They sit beside
// a text label everywhere except close and send, whose meaning is universal.

const paths = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M18.5 11a6.5 6.5 0 0 1-1 3.4M5.5 11a6.5 6.5 0 0 0 9.8 5.6M12 17.5V21M8.5 21h7M3.5 3.5l17 17" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="M15.5 10.5l5-3v9l-5-3" />
    </>
  ),
  cameraOff: (
    <>
      <path d="M8 6.5h5a2.5 2.5 0 0 1 2.5 2.5v2.5l5-3v9l-3.4-2M15.5 15.5A2.5 2.5 0 0 1 13 17.5H5.5A2.5 2.5 0 0 1 3 15V9a2.5 2.5 0 0 1 1.6-2.3" />
      <path d="M3.5 3.5l17 17" />
    </>
  ),
  leave: (
    <>
      <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M10 8l-4 4 4 4M6 12h9.5" />
    </>
  ),
  send: <path d="M4.5 12L20 4.5l-4.5 15-3.5-6.5-7.5-1z M12 13l3.5-3.5" />,
  pin: (
    <>
      <path d="M9 3.5h6M10 3.5v6l-3 3.5h10l-3-3.5v-6M12 13v7.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.8c1.8.6 3 2.2 3.5 4.7" />
    </>
  ),
  chat: <path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z" />,
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  share: (
    <>
      <path d="M12 3.5v11M8 7.5l4-4 4 4" />
      <path d="M8.5 11H6.5A1.5 1.5 0 0 0 5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5h-2" />
    </>
  ),
  crown: <path d="M4 17.5L3 8l5 4 4-6.5 4 6.5 5-4-1 9.5zM4.5 20.5h15" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </>
  ),
  flag: <path d="M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.25" />
      <circle cx="12" cy="12" r="1.25" />
      <circle cx="18.5" cy="12" r="1.25" />
    </>
  ),
  chevronLeft: <path d="M14.5 5.5L8 12l6.5 6.5" />,
  chevronRight: <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  chevronDown: <path d="M5.5 9.5L12 16l6.5-6.5" />,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 17.5h2" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14c.9 1.4 2.1 2 3.5 2s2.6-.6 3.5-2M9.25 9.5v.5M14.75 9.5v.5" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3.5" y="14" width="4" height="6.5" rx="1.5" />
      <rect x="16.5" y="14" width="4" height="6.5" rx="1.5" />
    </>
  ),
  external: <path d="M13.5 4.5H19.5V10.5M19.5 4.5L11 13M17 14.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8.5A1.5 1.5 0 0 1 6 7h3.5" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15" />,
  seat: (
    <>
      <path d="M7 13.5V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v6.5" />
      <path d="M4.5 12.5h15a.5.5 0 0 1 .5.5v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a.5.5 0 0 1 .5-.5zM7 18v2.5M17 18v2.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4M12 16.8v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.2" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 10.5v6M14 10.5v6" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </>
  ),
  userBack: (
    <>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 19.5c.6-3.2 3-5 6.5-5 1.4 0 2.6.3 3.6.8M15 16h6M18 13l-3 3 3 3" />
    </>
  ),
  volume: (
    <>
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  sync: <path d="M5 9a7.5 7.5 0 0 1 13.2-2.7L20 8M19 15a7.5 7.5 0 0 1-13.2 2.7L4 16M20 4v4h-4M4 20v-4h4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  puzzle: (
    <path d="M9 4.5a2 2 0 0 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 0 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 0 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 0 0 0-4H4V7a1 1 0 0 1 1-1h4z" />
  ),
} as const;

export type IconName = keyof typeof paths;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** A text alternative; omit when a visible label sits beside the icon. */
  title?: string;
}

export function Icon({ name, size = 20, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}

/** Google's four colour mark, used only on the "Sign in with Google" button per Google's guidelines. */
export function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
