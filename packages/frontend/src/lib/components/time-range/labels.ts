import { TIME_RANGE_LABELS, type TimeRangePreset } from '@logtide/shared';
import { displayPreferences } from '$lib/stores/display-preferences';
import type { TimeRangeValue } from '$lib/stores/scope-url';
import { resolveZone } from './zone.js';

// Local fallbacks for F1's getDisplayZoneLabel() and formatRange(from, to).
// When F1 has merged, replace the bodies of zoneLabel and formatRangeLabel
// with delegation in one commit; the tests stay as the behavioural spec.
// These are the only places in the time range components that may format
// dates directly.

export interface LabelOptions {
  zone?: string;
  hour12?: boolean;
}

function currentPrefs(opts?: LabelOptions): { zone: string; hour12: boolean } {
  const prefs = displayPreferences.get();
  return {
    zone: opts?.zone ?? resolveZone(prefs.timeZone),
    hour12: opts?.hour12 ?? prefs.hour12,
  };
}

/** `UTC`, `UTC+2`, `UTC-5`, `UTC+5:30`. */
export function zoneLabel(zone?: string, now: Date = new Date()): string {
  const tz = zone ?? resolveZone(displayPreferences.get().timeZone);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    return name.replace(/^GMT/, 'UTC');
  } catch {
    return 'UTC';
  }
}

function dayKey(d: Date, zone: string): { year: string; key: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { year: get('year'), key: `${get('year')}-${get('month')}-${get('day')}` };
}

function dateText(d: Date, zone: string, withYear: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(d);
}

function timeText(d: Date, zone: string, hour12: boolean): string {
  const fmt = hour12
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
  // Newer ICU uses narrow no-break spaces; keep the label plain ASCII.
  return fmt.format(d).replace(/[  ]/g, ' ');
}

export function formatRangeLabel(from: Date, to: Date, opts?: LabelOptions): string {
  const { zone, hour12 } = currentPrefs(opts);
  const a = dayKey(from, zone);
  const b = dayKey(to, zone);
  const withYear = a.year !== b.year;
  const t1 = timeText(from, zone, hour12);
  const t2 = timeText(to, zone, hour12);
  const d1 = dateText(from, zone, withYear);
  if (a.key === b.key) return `${d1}, ${t1} to ${t2}`;
  return `${d1}, ${t1} to ${dateText(to, zone, withYear)}, ${t2}`;
}

export function presetLabel(preset: TimeRangePreset): string {
  return TIME_RANGE_LABELS[preset];
}

export function rangeLabel(value: TimeRangeValue, opts?: LabelOptions): string {
  if (value.kind === 'preset') return presetLabel(value.preset);
  return formatRangeLabel(new Date(value.from), new Date(value.to), opts);
}
