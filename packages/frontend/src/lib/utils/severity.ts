import { getSeverityWeight } from '@logtide/shared';

/**
 * The single place that maps log level, SIEM severity and state to colours.
 * Everything uses semantic tokens (see app.css), which carry the dark variant,
 * so no raw palette classes appear here. Class names are written out in full so
 * the Tailwind JIT can see them.
 */
export type Tone = {
  /** Full class string for a bordered pill: background, text, border. */
  badge: string;
  /** Text colour class. */
  text: string;
  /** Background class for a status dot. */
  dot: string;
  /** Hex for ECharts, a mid tone readable on both themes. */
  chart: string;
};

const GRAY: Tone = {
  badge: 'bg-muted text-muted-foreground border-border',
  text: 'text-muted-foreground',
  dot: 'bg-muted-foreground',
  chart: '#6b7280',
};

const NEUTRAL: Tone = {
  badge: 'bg-secondary text-secondary-foreground border-border',
  text: 'text-secondary-foreground',
  dot: 'bg-foreground/50',
  chart: '#6b7280',
};

const BLUE: Tone = {
  badge: 'bg-info/15 text-info-text border-info/30',
  text: 'text-info-text',
  dot: 'bg-info',
  chart: '#3b82f6',
};

const AMBER: Tone = {
  badge: 'bg-warning/15 text-warning-text border-warning/30',
  text: 'text-warning-text',
  dot: 'bg-warning',
  chart: '#f59e0b',
};

const RED: Tone = {
  badge: 'bg-destructive/15 text-destructive-text border-destructive/30',
  text: 'text-destructive-text',
  dot: 'bg-destructive',
  chart: '#ef4444',
};

const PURPLE: Tone = {
  badge: 'bg-critical/15 text-critical-text border-critical/30',
  text: 'text-critical-text',
  dot: 'bg-critical',
  chart: '#a855f7',
};

const GREEN: Tone = {
  badge: 'bg-success/15 text-success-text border-success/30',
  text: 'text-success-text',
  dot: 'bg-success',
  chart: '#22c55e',
};

/** Fallback for any value the tables do not know. */
export const NEUTRAL_TONE: Tone = NEUTRAL;

const LEVEL_TONES: Record<string, Tone> = {
  debug: GRAY,
  info: BLUE,
  warn: AMBER,
  error: RED,
  critical: PURPLE,
};

const SEVERITY_TONES: Record<string, Tone> = {
  informational: BLUE,
  low: GRAY,
  medium: AMBER,
  high: RED,
  critical: PURPLE,
};

const STATE_TONES: Record<string, Tone> = {
  open: NEUTRAL,
  acknowledged: AMBER,
  resolved: GREEN,
  false_positive: GRAY,
  firing: RED,
  ok: GREEN,
  up: GREEN,
  down: RED,
  active: GREEN,
  snoozed: GRAY,
  disabled: GRAY,
  pending: NEUTRAL,
  failed: RED,
};

const ALIASES = {
  level: { warning: 'warn', fatal: 'critical', information: 'info' },
  severity: { info: 'informational' },
  state: { investigating: 'acknowledged', 'false-positive': 'false_positive' },
} as const;

type Kind = keyof typeof ALIASES;

const LABEL_OVERRIDES: Record<string, string> = {
  acknowledged: 'Acknowledged',
  false_positive: 'False positive',
  warn: 'Warning',
  ok: 'OK',
};

const has = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);

function normalize(kind: Kind, value: string): string {
  const key = String(value ?? '').trim().toLowerCase();
  const aliases: Record<string, string> = ALIASES[kind];
  return has(aliases, key) ? aliases[key] : key;
}

function lookup(table: Record<string, Tone>, key: string): Tone {
  return has(table, key) ? table[key] : NEUTRAL_TONE;
}

function label(kind: Kind, table: Record<string, Tone>, value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Unknown';
  const key = normalize(kind, raw);
  if (has(LABEL_OVERRIDES, key)) return LABEL_OVERRIDES[key];
  if (has(table, key)) return key.charAt(0).toUpperCase() + key.slice(1);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function levelTone(level: string): Tone {
  return lookup(LEVEL_TONES, normalize('level', level));
}

export function severityTone(sev: string): Tone {
  return lookup(SEVERITY_TONES, normalize('severity', sev));
}

export function stateTone(state: string): Tone {
  return lookup(STATE_TONES, normalize('state', state));
}

export function levelLabel(level: string): string {
  return label('level', LEVEL_TONES, level);
}

export function severityLabel(sev: string): string {
  return label('severity', SEVERITY_TONES, sev);
}

export function stateLabel(state: string): string {
  return label('state', STATE_TONES, state);
}

/** Ordering only (informational 1 to critical 5, unknown 0); carries no colour. */
export function severityWeight(sev: string): number {
  return getSeverityWeight(normalize('severity', sev) as Parameters<typeof getSeverityWeight>[0]);
}
