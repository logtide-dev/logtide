import type { UsageRecord } from '$lib/api/usage';

export interface DayRow {
  date: string;
  events: number;
  bytes: number;
}

/** Joins the per-day event and byte series into one row per day, newest first. */
export function mergeDaily(events: UsageRecord[], bytes: UsageRecord[]): DayRow[] {
  const map = new Map<string, DayRow>();
  const row = (date: string) => {
    let r = map.get(date);
    if (!r) {
      r = { date, events: 0, bytes: 0 };
      map.set(date, r);
    }
    return r;
  };
  for (const r of events) row(r.bucket ?? '').events += r.quantity;
  for (const r of bytes) row(r.bucket ?? '').bytes += r.quantity;
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function sumQuantity(records: UsageRecord[]): number {
  return records.reduce((s, r) => s + r.quantity, 0);
}
