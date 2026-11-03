/**
 * Bucket boundaries of the hourly and daily continuous aggregates
 * (time_bucket('1 hour') and time_bucket('1 day') are aligned to UTC).
 *
 * Readers that combine an aggregate with a raw tail must split at one of these
 * boundaries: the aggregate is real-time, so it covers every bucket before the
 * split in full, and the raw tail starts exactly where it stops.
 */
export function startOfUtcHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
