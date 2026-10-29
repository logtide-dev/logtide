/** Shared number formatting. Always en-US; "-" for null, undefined or NaN. */

const EMPTY = '-';

function valid(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** 1234567 -> "1,234,567" */
export function formatCount(n: number | null | undefined): string {
  return valid(n) ? n.toLocaleString('en-US') : EMPTY;
}

/** 1200 -> "1.2K", 3400000 -> "3.4M" */
export function formatCompact(n: number | null | undefined): string {
  return valid(n) ? compact.format(n) : EMPTY;
}

/** Binary units (1024 base), one decimal above bytes: 1536 -> "1.5 KB" */
export function formatBytes(n: number | null | undefined): string {
  if (!valid(n)) return EMPTY;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.abs(n);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const sign = n < 0 ? '-' : '';
  return i === 0 ? `${sign}${value} B` : `${sign}${value.toFixed(1)} ${units[i]}`;
}

/** 12.345 -> "12.3%" (the value is already a percentage, not a ratio) */
export function formatPercent(n: number | null | undefined, digits = 1): string {
  return valid(n) ? `${n.toFixed(digits)}%` : EMPTY;
}
