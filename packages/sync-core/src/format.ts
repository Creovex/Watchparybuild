/** Formats seconds as m:ss, or h:mm:ss from an hour, for timecodes people read while watching. */
export function formatTimecode(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Parses "1:02:03", "2:03" or "123" into seconds; null when it is not a time. */
export function parseTimecode(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** "You're about N seconds ahead/behind" for cue sync's "Where am I?". */
export function describeOffset(offsetSec: number): string {
  const rounded = Math.round(Math.abs(offsetSec));
  if (rounded === 0) return "You're in sync";
  const unit = rounded === 1 ? 'second' : 'seconds';
  return `You're about ${rounded} ${unit} ${offsetSec > 0 ? 'ahead' : 'behind'}`;
}
