export interface HistoryBucket {
  bucket: string;
  uptimePct: number | string;
  totalChecks?: number;
}

export type DaySlot =
  | { day: string; uptimePct: number; totalChecks: number }
  | { day: string; uptimePct: null };

const DAY_MS = 86_400_000;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * One slot per UTC day, oldest first, the last slot is today. Days without data
 * stay empty (null): a short history is never padded with made-up percentages.
 */
export function buildDaySlots(
  history: HistoryBucket[],
  days: number,
  today: Date = new Date()
): DaySlot[] {
  const byDay = new Map<string, { uptimePct: number; totalChecks: number }>();
  for (const b of history) {
    const t = new Date(b.bucket);
    if (isNaN(t.getTime())) continue;
    const pct = Number(b.uptimePct);
    if (!Number.isFinite(pct)) continue;
    if (b.totalChecks === 0) continue;
    byDay.set(utcDay(t), { uptimePct: pct, totalChecks: b.totalChecks ?? 1 });
  }

  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const slots: DaySlot[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(todayStart - i * DAY_MS));
    const hit = byDay.get(day);
    slots.push(hit ? { day, ...hit } : { day, uptimePct: null });
  }
  return slots;
}

// Uptime buckets are UTC days, so this is the one formatter that deliberately
// ignores the display time zone preference: shifting it would label a bucket
// with the wrong calendar day.
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

export function formatBucketDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return isNaN(d.getTime()) ? day : DAY_FORMAT.format(d);
}

/** Uptime weighted by the number of checks per day, null when there is no data. */
export function weightedUptime(slots: DaySlot[]): number | null {
  let weighted = 0;
  let total = 0;
  for (const s of slots) {
    if (s.uptimePct === null) continue;
    weighted += s.uptimePct * s.totalChecks;
    total += s.totalChecks;
  }
  if (total === 0) return null;
  return Math.round((weighted / total) * 100) / 100;
}
