import { ImageResponse } from 'next/og';
import { APP_NAME } from './env';

// Placeholder app icon generated from the app name until James supplies art (gap G16): the first
// letter in amber on the ink background, with the three marquee bulbs from the wordmark.
export function iconResponse(size: number, { maskable = false } = {}) {
  const letter = (Array.from(APP_NAME.trim())[0] ?? 'S').toUpperCase();
  const pad = maskable ? size * 0.2 : size * 0.08;
  const inner = size - pad * 2;
  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f0d0c',
          borderRadius: maskable ? 0 : size * 0.22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: inner * 0.06 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: inner * 0.05 }}>
            {[1, 0.6, 0.3].map((opacity) => (
              <div
                key={opacity}
                style={{
                  width: inner * 0.09,
                  height: inner * 0.09,
                  borderRadius: inner,
                  background: '#ffb84d',
                  opacity,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', color: '#ffb84d', fontSize: inner * 0.66, fontWeight: 800, lineHeight: 1 }}>
            {letter}
          </div>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
