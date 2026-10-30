import type { DisplayPreferences } from '$lib/stores/display-preferences';
import { formatTimestamp as formatInstant, type TimestampOptions } from '$lib/utils/datetime';

// Single formatter for dashboard timestamps, so the viewer's clock preference
// (12h/24h + explicit IANA timezone, issue #297) applies everywhere at once.
// It only picks the datetime.ts options for a style; datetime.ts does the
// formatting (en-US, narrow no-break spaces normalized, invalid zones fall back
// to the browser zone).
export type TimestampStyle = 'time' | 'timeSeconds' | 'monthDay' | 'dateTime';

const STYLE_OPTIONS: Record<TimestampStyle, TimestampOptions> = {
  time: { precision: 'minute', withDate: false },
  timeSeconds: { precision: 'second', withDate: false },
  monthDay: { dateOnly: true },
  dateTime: { precision: 'minute', withDate: true },
};

export function formatTimestamp(
  time: string | number | Date,
  style: TimestampStyle,
  prefs: DisplayPreferences
): string {
  return formatInstant(time, { ...STYLE_OPTIONS[style], prefs });
}
