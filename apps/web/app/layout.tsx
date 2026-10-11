import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { connection } from 'next/server';
import { ToastProvider } from '@watchparty/ui';
import { APP_NAME, SITE_URL } from '@/lib/env';
import './globals.css';

// Marquee lettering for headlines, a sturdy grotesque for reading, a monospace for timecodes.
const marquee = Big_Shoulders({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-marquee',
  display: 'swap',
  adjustFontFallback: false,
});
const grotesk = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' });
const timecode = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-timecode', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Watch YouTube, Netflix, Prime Video and Disney+ in sync with friends, with voice, chat and reactions.',
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#0f0d0c',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render every page per request: Next.js stamps the CSP nonce from proxy.ts on its scripts only
  // when the page is rendered for that request.
  await connection();
  return (
    <html lang="en" className={`${marquee.variable} ${grotesk.variable} ${timecode.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
