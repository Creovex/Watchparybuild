import type { Source } from './schemas';

// Content references: the identifier of a title on its source. The database applies the same rules
// in `public.valid_content_ref`, so a reference accepted here is accepted there.

export type ContentRefResult =
  | { ok: true; ref: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'live_stream' };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = /^(www\.|m\.|music\.)?youtube\.com$/;

export const PAID_SOURCE_HOSTS: Record<Exclude<Source, 'youtube'>, RegExp> = {
  netflix: /^(www\.)?netflix\.com$/,
  prime: /^(www\.)?(primevideo\.com|amazon\.(com|co\.uk|de|ca))$/,
  disney: /^(www\.)?disneyplus\.com$/,
};

function toUrl(input: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

export function parseYouTubeRef(raw: string): ContentRefResult {
  const input = raw.trim();
  if (!input) return { ok: false, reason: 'empty' };
  if (YOUTUBE_ID.test(input)) return { ok: true, ref: input };
  const url = toUrl(input);
  if (!url) return { ok: false, reason: 'invalid' };
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.test(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'live') return { ok: false, reason: 'live_stream' };
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts') id = parts[1] ?? null;
  }
  if (id && YOUTUBE_ID.test(id)) return { ok: true, ref: id };
  return { ok: false, reason: 'invalid' };
}

export function parsePaidRef(source: Exclude<Source, 'youtube'>, raw: string): ContentRefResult {
  const input = raw.trim();
  if (!input) return { ok: false, reason: 'empty' };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'invalid' };
  if (!PAID_SOURCE_HOSTS[source].test(url.hostname.toLowerCase())) return { ok: false, reason: 'invalid' };
  url.hash = '';
  return { ok: true, ref: url.toString() };
}

export function parseContentRef(source: Source, raw: string): ContentRefResult {
  return source === 'youtube' ? parseYouTubeRef(raw) : parsePaidRef(source, raw);
}

/** The address that opens a content reference on its own service. */
export function contentUrl(source: Source, ref: string): string {
  return source === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(ref)}` : ref;
}

export const SOURCE_LABEL: Record<Source, string> = {
  youtube: 'YouTube',
  netflix: 'Netflix',
  prime: 'Prime Video',
  disney: 'Disney+',
};
