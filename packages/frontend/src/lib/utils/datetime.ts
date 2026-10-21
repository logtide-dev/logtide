import { displayPreferences, resolveTimeZone } from '$lib/stores/display-preferences';

/**
 * The one place that turns instants into text. Every function reads the
 * display preferences (clock format and time zone) at call time, so a
 * component that must re-render when they change has to read
 * `$displayPreferences` itself (see Timestamp.svelte). Output is pinned to
 * en-US so it does not depend on the machine locale.
 */

const INVALID = 'Invalid date';

export type TimestampPrecision = 'minute' | 'second' | 'ms';

export interface TimestampOptions {
  precision?: TimestampPrecision;
  withDate?: boolean;
  withZone?: boolean;
}

// ---------------------------------------------------------------------------
// Internals: zone resolution and a formatter cache
// ---------------------------------------------------------------------------

const validZones = new Set<string>();
const invalidZones = new Set<string>();
const formatterCache = new Map<string, Intl.DateTimeFormat>();

/** Replaces narrow no-break and no-break spaces that newer ICU versions emit. */
function plain(text: string): string {
  return text.replace(/[  ]/g, ' ');
}

/**
 * The zone to hand to Intl, or undefined for the browser zone. A stored zone
 * this runtime does not know ("Not/AZone") is detected once, warned about once
 * and treated as the browser zone from then on.
 */
function activeZone(): string | undefined {
  const zone = resolveTimeZone(displayPreferences.get().timeZone);
  if (!zone || invalidZones.has(zone)) return undefined;
  if (validZones.has(zone)) return zone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    validZones.add(zone);
    return zone;
  } catch {
    invalidZones.add(zone);
    console.warn(`Unknown time zone "${zone}" in display preferences, using the browser zone`);
    return undefined;
  }
}

function formatterFor(options: Intl.DateTimeFormatOptions, zone: string | undefined): Intl.DateTimeFormat {
  const key = `${JSON.stringify(options)}|${zone ?? ''}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', zone ? { ...options, timeZone: zone } : options);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return isNaN(d.getTime()) ? null : d;
}

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(d: Date, options: Intl.DateTimeFormatOptions): Parts {
  const out: Parts = {};
  for (const p of formatterFor(options, activeZone()).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

const ALL_PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
};

function allParts(d: Date): Parts {
  const hour12 = displayPreferences.get().hour12;
  return partsOf(d, { ...ALL_PARTS, hourCycle: hour12 ? 'h12' : 'h23' });
}

function timeText(p: Parts, precision: TimestampPrecision, hour12: boolean): string {
  let text = `${p.hour}:${p.minute}`;
  if (precision !== 'minute') text += `:${p.second}`;
  if (precision === 'ms') text += `.${p.fractionalSecond}`;
  if (hour12) text += ` ${p.dayPeriod ?? ''}`.trimEnd();
  return plain(text);
}

function dateText(p: Parts, now: Date): string {
  const currentYear = partsOf(now, { year: 'numeric' }).year;
  const base = `${p.month} ${p.day}`;
  return p.year !== currentYear ? `${base}, ${p.year}` : base;
}

// ---------------------------------------------------------------------------
// Contract functions
// ---------------------------------------------------------------------------

/** Label of the display zone: "UTC", "UTC+2", "UTC-5", "UTC+5:30". */
export function getDisplayZoneLabel(at: Date = new Date()): string {
  const d = toDate(at) ?? new Date();
  try {
    const name = partsOf(d, { timeZoneName: 'shortOffset' }).timeZoneName ?? 'GMT';
    if (name === 'GMT' || name === 'UTC') return 'UTC';
    return plain(name).replace(/^GMT/, 'UTC');
  } catch {
    return 'UTC';
  }
}

/** Absolute timestamp such as "Oct 21, 10:42:13" in the display zone and clock. */
export function formatTimestamp(value: string | number | Date, opts: TimestampOptions = {}): string {
  const d = toDate(value);
  if (!d) return INVALID;
  const { precision = 'second', withDate = true, withZone = false } = opts;
  const hour12 = displayPreferences.get().hour12;
  const p = allParts(d);
  const time = timeText(p, precision, hour12);
  let text = withDate ? `${dateText(p, new Date())}, ${time}` : time;
  if (withZone) text += ` ${getDisplayZoneLabel(d)}`;
  return text;
}

function pastWording(diffMs: number): string {
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function futureWording(diffMs: number): string {
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `in ${mins} minute${mins > 1 ? 's' : ''}`;
  if (hours < 24) return `in ${hours} hour${hours > 1 ? 's' : ''}`;
  return `in ${days} day${days > 1 ? 's' : ''}`;
}

/** "just now", "5 minutes ago", "in 2 hours"; older than 30 days falls back to an absolute date. */
export function formatRelative(value: string | number | Date, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return INVALID;
  const diff = now.getTime() - d.getTime();
  if (diff >= 0) {
    if (Math.floor(diff / 86400000) > 30) return formatTimestamp(d, { precision: 'minute' });
    return pastWording(diff);
  }
  if (Math.floor(-diff / 86400000) > 30) return formatTimestamp(d, { precision: 'minute' });
  return futureWording(-diff);
}

/** "Oct 21, 10:00 to 11:00" on one day, "Oct 21, 10:00 to Oct 22, 09:00" across days. */
export function formatRange(from: Date | string, to: Date | string): string {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return INVALID;
  const hour12 = displayPreferences.get().hour12;
  const pa = allParts(a);
  const pb = allParts(b);
  const sameDay = pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
  const now = new Date();
  const start = `${dateText(pa, now)}, ${timeText(pa, 'minute', hour12)}`;
  const end = sameDay
    ? timeText(pb, 'minute', hour12)
    : `${dateText(pb, now)}, ${timeText(pb, 'minute', hour12)}`;
  return `${start} to ${end}`;
}

// ---------------------------------------------------------------------------
// Existing exports, now honouring the time zone preference
// ---------------------------------------------------------------------------

/**
 * Format a date/timestamp as "YYYY-MM-DD HH:mm:ss" (24 hour) in the display zone.
 * Handles both Date objects and ISO 8601 strings from the backend.
 */
export function formatDateTime(date: Date | string): string {
  const d = toDate(date);
  if (!d) return INVALID;
  const p = partsOf(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Format a date/timestamp to a more readable format with the short zone name.
 */
export function formatDateTimeLong(date: Date | string): string {
  const d = toDate(date);
  if (!d) return INVALID;
  return plain(
    formatterFor(
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      },
      activeZone(),
    ).format(d),
  );
}

/**
 * Format relative time (e.g., "2 minutes ago", "just now"), with no upper
 * bound on the unit. Call it with a reactive current time to re-render as time
 * passes.
 */
export function formatTimeAgo(date: Date | string, now: Date = new Date()): string {
  const d = toDate(date);
  if (!d) return INVALID;
  return pastWording(now.getTime() - d.getTime());
}

/**
 * Format a date as a short, consistent absolute date (e.g. "Apr 12, 2026").
 * Use for record dates (joined, created) where an absolute value reads better
 * than a relative one, pairing it with formatTimeAgo() in a tooltip.
 */
export function formatDateShort(date: Date | string): string {
  const d = toDate(date);
  if (!d) return INVALID;
  return plain(
    formatterFor({ year: 'numeric', month: 'short', day: 'numeric' }, activeZone()).format(d),
  );
}

/**
 * Get the browser's timezone
 */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
