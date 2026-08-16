import type { DisplayPreferences } from '$lib/stores/display-preferences';

// Single formatter for dashboard timestamps, so the viewer's clock preference
// (12h/24h + explicit IANA timezone, issue #297) applies everywhere at once.
// The locale stays pinned to en-US on purpose: output must not depend on the
// machine locale, the preference replaces locale sniffing.
export type TimestampStyle = 'time' | 'timeSeconds' | 'monthDay' | 'dateTime';

const STYLE_OPTIONS: Record<TimestampStyle, Intl.DateTimeFormatOptions> = {
  time: { hour: '2-digit', minute: '2-digit' },
  timeSeconds: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  monthDay: { month: 'short', day: 'numeric' },
  dateTime: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
};

// hourCycle 'h23' rather than hour12:false: en-US with hour12:false renders
// midnight as 24:00 on some ICU versions.
const CLOCK_24: Intl.DateTimeFormatOptions = { hourCycle: 'h23' };
const CLOCK_12: Intl.DateTimeFormatOptions = { hour12: true };

// Some ICU builds separate the AM/PM marker with a narrow no-break space
// (U+202F), older ones with a regular no-break space (U+00A0); normalize both
// to a plain space so output stays stable across builds. Escape syntax on
// purpose: the source must not carry invisible characters.
function normalize(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ');
}

export function formatTimestamp(
  time: string | number | Date,
  style: TimestampStyle,
  prefs: DisplayPreferences
): string {
  const date = time instanceof Date ? time : new Date(time);
  const clock = style === 'monthDay' ? {} : prefs.hour12 ? CLOCK_12 : CLOCK_24;
  const opts: Intl.DateTimeFormatOptions = { ...STYLE_OPTIONS[style], ...clock };
  try {
    // An invalid IANA zone throws; fall back to the browser zone rather than
    // letting a stale preference break every panel that renders a time.
    return normalize(date.toLocaleString('en-US', { ...opts, timeZone: prefs.timeZone ?? undefined }));
  } catch {
    return normalize(date.toLocaleString('en-US', opts));
  }
}
