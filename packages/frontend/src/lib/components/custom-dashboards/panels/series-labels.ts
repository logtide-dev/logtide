import type { LogLevelKey } from '@logtide/shared';

const DEFAULT_LABELS: Record<LogLevelKey, string> = {
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  critical: 'Critical',
};

/** Display label for a time_series level: custom label when set, canonical fallback otherwise. */
export function resolveSeriesLabel(
  level: LogLevelKey,
  seriesLabels?: Partial<Record<LogLevelKey, string>>
): string {
  const custom = seriesLabels?.[level]?.trim();
  return custom ? custom : DEFAULT_LABELS[level];
}
