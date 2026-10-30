import { fromDate, getLocalTimeZone, parseDateTime, toZoned } from '@internationalized/date';

// Zone helpers for the custom range editor. Values are shown and parsed in the
// user's display zone, which may differ from the browser zone.

function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA id for a display preference; null, 'browser', empty or invalid means the browser zone. */
export function resolveZone(pref?: string | null): string {
  if (!pref || pref === 'browser') return getLocalTimeZone();
  return isValidZone(pref) ? pref : getLocalTimeZone();
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** `YYYY-MM-DDTHH:mm` wall clock of `date` in `zone`. */
export function toInputValue(date: Date, zone: string): string {
  const z = fromDate(date, zone);
  return `${pad(z.year, 4)}-${pad(z.month)}-${pad(z.day)}T${pad(z.hour)}:${pad(z.minute)}`;
}

const INPUT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Instant for a `YYYY-MM-DDTHH:mm` wall clock in `zone`; null when incomplete or invalid. */
export function fromInputValue(text: string, zone: string): Date | null {
  if (typeof text !== 'string' || !INPUT_RE.test(text)) return null;
  try {
    return toZoned(parseDateTime(text), zone, 'compatible').toDate();
  } catch {
    return null;
  }
}
