// Which pages of each paid source the extension works on. Kept free of imports so the build's
// manifest config can read it directly. DEFAULT until spike S1 records the exact paths (gap G2).

export type PaidSourceName = 'netflix' | 'prime' | 'disney';

const AMAZON_DOMAINS = ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca'];

export const WATCH_PAGES: Record<PaidSourceName, { watchPages: string[]; origins: string[] }> = {
  netflix: {
    watchPages: ['https://www.netflix.com/watch/*'],
    origins: ['https://www.netflix.com/*'],
  },
  prime: {
    // Prime Video plays over its detail pages, so the whole Prime Video site and Amazon's video
    // section match until S1 records the exact paths.
    watchPages: ['https://www.primevideo.com/*', ...AMAZON_DOMAINS.map((d) => `https://www.${d}/gp/video/*`)],
    origins: ['https://www.primevideo.com/*', ...AMAZON_DOMAINS.map((d) => `https://www.${d}/*`)],
  },
  disney: {
    watchPages: [
      'https://www.disneyplus.com/video/*',
      'https://www.disneyplus.com/*/video/*',
      'https://www.disneyplus.com/play/*',
      'https://www.disneyplus.com/*/play/*',
    ],
    origins: ['https://www.disneyplus.com/*'],
  },
};

const ORDER: PaidSourceName[] = ['netflix', 'prime', 'disney'];

/** Content script match patterns for every service's watch pages. */
export function allWatchPages(): string[] {
  return ORDER.flatMap((s) => WATCH_PAGES[s].watchPages);
}

/** Service origins for `web_accessible_resources`, which accepts only "/*" paths. */
export function allServiceOrigins(): string[] {
  return ORDER.flatMap((s) => WATCH_PAGES[s].origins);
}
