import { PAID_SOURCE_HOSTS, type AdapterCapabilities, type PaidSource } from '@watchparty/sync-core';
import { allServiceOrigins, allWatchPages, WATCH_PAGES } from './watch-pages';

// What the extension knows about each paid source: what its player can do (S1_RESULTS), which
// pages are watch pages (from watch-pages.ts) and how a title is named in its addresses. Spike S1
// (gaps G1 and G2) has not run, so every row is marked DEFAULT and uses the conservative values from
// decision rule 1: no seeking and no fine rates, volume on.

export type ResultStatus = 'DEFAULT' | 'S1';

export interface ServiceProfile {
  label: string;
  /** Where these values came from: DEFAULT until spike S1 records a result for the service. */
  status: ResultStatus;
  capabilities: AdapterCapabilities;
  /** Content script match patterns for the service's watch pages (src/shared/watch-pages.ts). */
  watchPages: string[];
}

const DEFAULT_CAPABILITIES: AdapterCapabilities = { seek: false, fineRate: false, volume: true, seekLatencySec: 0.5 };

/**
 * Per service results of spike S1. Flip `seek` (and `fineRate`) here once S1 proves them for a
 * service; the adapter's seek code is already in place behind the flag.
 */
export const S1_RESULTS: Record<PaidSource, ServiceProfile> = {
  netflix: { label: 'Netflix', status: 'DEFAULT', capabilities: { ...DEFAULT_CAPABILITIES }, watchPages: WATCH_PAGES.netflix.watchPages },
  prime: { label: 'Prime Video', status: 'DEFAULT', capabilities: { ...DEFAULT_CAPABILITIES }, watchPages: WATCH_PAGES.prime.watchPages },
  disney: { label: 'Disney+', status: 'DEFAULT', capabilities: { ...DEFAULT_CAPABILITIES }, watchPages: WATCH_PAGES.disney.watchPages },
};

export const PAID: readonly PaidSource[] = ['netflix', 'prime', 'disney'];

export { allServiceOrigins, allWatchPages };

/** The paid source a host name belongs to, or null. */
export function sourceForHost(hostname: string): PaidSource | null {
  const host = hostname.toLowerCase();
  for (const source of PAID) {
    if (PAID_SOURCE_HOSTS[source].test(host)) return source;
  }
  return null;
}

/** Converts a Chrome match pattern with a fixed scheme and host into a regular expression. */
export function matchPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** True when the address is a watch page the content script runs on. */
export function isWatchPage(url: string): boolean {
  return allWatchPages().some((p) => matchPatternToRegExp(p).test(url));
}

// How a title is named in each service's addresses. DEFAULT until S1 records the formats (gap G2).
const TITLE_PATTERNS: Record<PaidSource, RegExp[]> = {
  netflix: [/^\/watch\/(\d+)/],
  prime: [/\/detail\/([A-Za-z0-9]+)/, /\/dp\/([A-Za-z0-9]{10})/],
  disney: [/\/(?:video|play)\/([A-Za-z0-9-]+)/],
};

/**
 * A stable name for the title an address points at, ignoring tracking parameters, so the room's
 * content reference and a tab's address can be compared. Null when the address names no title.
 */
export function titleKey(source: PaidSource, url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (sourceForHost(parsed.hostname) !== source) return null;
  for (const pattern of TITLE_PATTERNS[source]) {
    const match = pattern.exec(parsed.pathname);
    if (match?.[1]) return `${source}:${match[1]}`;
  }
  return null;
}
