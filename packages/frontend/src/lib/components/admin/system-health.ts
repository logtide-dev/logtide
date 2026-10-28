import type { DataTableSort } from '$lib/components/app/data-table';

/** Maps a backend component status to a state tone key (see utils/severity.ts) and a label. */
export function healthState(status: string | null | undefined): { state: string; label: string } {
  switch (status) {
    case 'healthy':
      return { state: 'ok', label: 'Healthy' };
    case 'degraded':
      return { state: 'acknowledged', label: 'Degraded' };
    case 'down':
      return { state: 'down', label: 'Down' };
    case 'not_configured':
      return { state: 'disabled', label: 'Not configured' };
    default:
      return { state: 'pending', label: 'Unknown' };
  }
}

const SIZE_UNITS: Record<string, number> = {
  bytes: 1,
  byte: 1,
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
  tb: 1024 ** 4,
  pb: 1024 ** 5,
};

/** Parses backend pre-formatted sizes ("12 MB", "8192 bytes") to bytes, for sorting only. */
export function parseSizeToBytes(size: string | null | undefined): number {
  if (!size) return 0;
  const m = /^\s*([\d.]+)\s*([a-z]+)?\s*$/i.exec(size);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = SIZE_UNITS[(m[2] ?? 'b').toLowerCase()] ?? 1;
  return Number.isFinite(n) ? n * unit : 0;
}

/** 850 -> "850ms", 1500 -> "1.5s", 125000 -> "2m 5s". "-" when unavailable. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/** "updated 12s ago" style label. */
export function formatUpdatedAgo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Client-side sort. Returns the input untouched when there is no sort or no accessor. */
export function sortRows<T>(
  rows: T[],
  sort: DataTableSort | undefined,
  accessors: Record<string, (row: T) => number | string>,
): T[] {
  if (!sort) return rows;
  const get = accessors[sort.key];
  if (!get) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/** Staleness of a continuous aggregate refresh, as a label and a tone text key. */
export function aggregateStaleness(
  lastRefresh: string | null,
  now: number = Date.now(),
): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!lastRefresh) return { label: 'Never refreshed', tone: 'bad' };
  const diffMin = Math.max(0, Math.round((now - new Date(lastRefresh).getTime()) / 60000));
  if (diffMin < 120) return { label: `${diffMin}m ago`, tone: 'ok' };
  if (diffMin < 1440) return { label: `${Math.round(diffMin / 60)}h ago`, tone: 'warn' };
  return { label: `${Math.round(diffMin / 1440)}d ago`, tone: 'bad' };
}
