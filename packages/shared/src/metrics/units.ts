// ============================================================================
// Metric units (1.8)
// ============================================================================
//
// OTLP units are UCUM-like strings ("By", "By/s", "s", "%", "1", "Cel",
// "{operation}/s"). These helpers format values for axes, legends, tooltips
// and stat cards, so every surface shows the same thing.

export type MetricUnitFamily =
  | 'percent'
  | 'ratio'
  | 'bytes'
  | 'bytes_rate'
  | 'bits'
  | 'bits_rate'
  | 'duration'
  | 'temperature'
  | 'count'
  | 'rate'
  | 'other'
  | 'none';

const DURATION_TO_SECONDS: Record<string, number> = {
  ns: 1e-9,
  us: 1e-6,
  ms: 1e-3,
  s: 1,
  min: 60,
  h: 3600,
  d: 86400,
};

const BYTE_PREFIX: Record<string, number> = {
  By: 1,
  kBy: 1e3,
  MBy: 1e6,
  GBy: 1e9,
  TBy: 1e12,
  KiBy: 1024,
  MiBy: 1024 ** 2,
  GiBy: 1024 ** 3,
  TiBy: 1024 ** 4,
};

/** Strips UCUM annotations: "{request}" -> "", "{operation}/s" -> "/s", "By{read}" -> "By". */
function stripAnnotations(unit: string): string {
  return unit.replace(/\{[^}]*\}/g, '').trim();
}

/** Classifies a unit. Unknown non-empty units are 'other' and shown verbatim. */
export function metricUnitFamily(unit: string | null | undefined): MetricUnitFamily {
  if (!unit) return 'none';
  if (unit === '%') return 'percent';
  if (unit === '1') return 'ratio';
  const bare = stripAnnotations(unit);
  if (bare === '' ) return 'count';
  if (bare === '/s') return 'rate';
  if (bare in BYTE_PREFIX) return 'bytes';
  const [num, den] = bare.split('/');
  if (den === 's' && num in BYTE_PREFIX) return 'bytes_rate';
  if (bare === 'bit' || bare === 'kbit' || bare === 'Mbit') return 'bits';
  if (den === 's' && (num === 'bit' || num === 'kbit' || num === 'Mbit')) return 'bits_rate';
  if (bare in DURATION_TO_SECONDS) return 'duration';
  if (bare === 'Cel' || bare === 'K' || bare === '[degF]') return 'temperature';
  if (den === 's' || den === 'min') return 'rate';
  return 'other';
}

function trimNumber(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Number with up to `digits` decimals, en-US grouping, no trailing zeros. */
export function formatPlainNumber(value: number, digits = 2): string {
  const abs = Math.abs(value);
  // Small non-zero values keep two significant digits instead of rounding to 0.
  if (abs > 0 && abs < 0.01) return Number(value.toPrecision(2)).toString();
  const d = abs >= 100 ? 0 : abs >= 10 ? Math.min(digits, 1) : digits;
  const [int, frac] = trimNumber(value, d).split('.');
  const grouped = Number(int).toLocaleString('en-US');
  return frac ? `${grouped}.${frac}` : grouped;
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trimNumber(value / 1e9, 1)}B`;
  if (abs >= 1e6) return `${trimNumber(value / 1e6, 1)}M`;
  if (abs >= 1e4) return `${trimNumber(value / 1e3, 1)}k`;
  return formatPlainNumber(value);
}

function scaleBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatPlainNumber(v, i === 0 ? 0 : 1)} ${units[i]}`;
}

function scaleBits(bits: number): string {
  const units = ['bit', 'kbit', 'Mbit', 'Gbit', 'Tbit'];
  let v = bits;
  let i = 0;
  while (Math.abs(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${formatPlainNumber(v, 1)} ${units[i]}`;
}

function formatSeconds(seconds: number): string {
  const abs = Math.abs(seconds);
  if (abs === 0) return '0 s';
  if (abs < 1e-6) return `${formatPlainNumber(seconds * 1e9)} ns`;
  if (abs < 1e-3) return `${formatPlainNumber(seconds * 1e6)} µs`;
  if (abs < 1) return `${formatPlainNumber(seconds * 1e3)} ms`;
  if (abs < 120) return `${formatPlainNumber(seconds)} s`;
  if (abs < 7200) return `${formatPlainNumber(seconds / 60, 1)} min`;
  if (abs < 172800) return `${formatPlainNumber(seconds / 3600, 1)} h`;
  return `${formatPlainNumber(seconds / 86400, 1)} d`;
}

/**
 * True when a "1" (dimensionless) metric is a 0-1 ratio meant as a
 * percentage: utilization-style names. Other "1" metrics (load average,
 * counts, status codes) stay plain numbers.
 */
export function isRatioPercentMetric(metricName: string | null | undefined, unit: string | null | undefined): boolean {
  return unit === '1' && !!metricName && /(utilization|ratio|usage_ratio)$/.test(metricName);
}

/**
 * Formats one value for display. `metricName` lets "1" utilization ratios
 * show as percentages. null/NaN give an em-free placeholder "n/a".
 */
export function formatMetricValue(
  value: number | null | undefined,
  unit: string | null | undefined,
  metricName?: string | null,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  if (isRatioPercentMetric(metricName, unit)) return `${formatPlainNumber(value * 100, 1)}%`;
  const family = metricUnitFamily(unit);
  const bare = unit ? stripAnnotations(unit) : '';
  switch (family) {
    case 'none':
    case 'ratio':
      return compact(value);
    case 'percent':
      return `${formatPlainNumber(value, 1)}%`;
    case 'count':
      return compact(value);
    case 'rate':
      return `${compact(value)}/s`;
    case 'bytes':
      return scaleBytes(value * BYTE_PREFIX[bare]);
    case 'bytes_rate':
      return `${scaleBytes(value * BYTE_PREFIX[bare.split('/')[0]])}/s`;
    case 'bits': {
      const mult = bare === 'kbit' ? 1e3 : bare === 'Mbit' ? 1e6 : 1;
      return scaleBits(value * mult);
    }
    case 'bits_rate': {
      const num = bare.split('/')[0];
      const mult = num === 'kbit' ? 1e3 : num === 'Mbit' ? 1e6 : 1;
      return `${scaleBits(value * mult)}/s`;
    }
    case 'duration':
      return formatSeconds(value * DURATION_TO_SECONDS[bare]);
    case 'temperature':
      return bare === 'Cel' ? `${formatPlainNumber(value, 1)} °C` : bare === 'K' ? `${formatPlainNumber(value, 1)} K` : `${formatPlainNumber(value, 1)} °F`;
    default:
      return `${compact(value)} ${unit}`;
  }
}

/**
 * Short unit label for an axis title or a column header ("%", "bytes/s",
 * "ms", "°C"), or null when the number speaks for itself.
 */
export function metricUnitLabel(unit: string | null | undefined, metricName?: string | null): string | null {
  if (isRatioPercentMetric(metricName, unit)) return '%';
  const family = metricUnitFamily(unit);
  switch (family) {
    case 'none':
    case 'ratio':
    case 'count':
      return null;
    case 'percent':
      return '%';
    case 'bytes':
      return 'bytes';
    case 'bytes_rate':
      return 'bytes/s';
    case 'bits':
      return 'bits';
    case 'bits_rate':
      return 'bits/s';
    case 'duration':
      return 'time';
    case 'temperature':
      return unit === 'Cel' ? '°C' : unit === 'K' ? 'K' : '°F';
    case 'rate':
      return '/s';
    default:
      return unit ?? null;
  }
}

/** Multiplier that turns stored values into display values for chart axes (ratios to %). */
export function metricDisplayScale(unit: string | null | undefined, metricName?: string | null): number {
  return isRatioPercentMetric(metricName, unit) ? 100 : 1;
}
