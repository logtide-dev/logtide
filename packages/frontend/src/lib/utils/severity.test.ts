import { describe, it, expect } from 'vitest';
import {
  levelTone, severityTone, stateTone, levelLabel, severityLabel, stateLabel,
  severityWeight, NEUTRAL_TONE,
} from './severity';

const GRAY = '#6b7280', BLUE = '#3b82f6', AMBER = '#f59e0b', RED = '#ef4444', PURPLE = '#a855f7', GREEN = '#22c55e';

describe('levelTone', () => {
  it.each([
    ['debug', GRAY, 'muted'],
    ['info', BLUE, 'info'],
    ['warn', AMBER, 'warning'],
    ['error', RED, 'destructive'],
    ['critical', PURPLE, 'critical'],
  ])('%s', (v, chart, token) => {
    expect(levelTone(v).chart).toBe(chart);
    expect(levelTone(v).badge).toContain(token);
  });
});

describe('severityTone', () => {
  it.each([
    ['informational', BLUE, 'info'],
    ['low', GRAY, 'muted'],
    ['medium', AMBER, 'warning'],
    ['high', RED, 'destructive'],
    ['critical', PURPLE, 'critical'],
  ])('%s', (v, chart, token) => {
    expect(severityTone(v).chart).toBe(chart);
    expect(severityTone(v).badge).toContain(token);
  });
});

describe('stateTone', () => {
  it.each([
    ['open', GRAY, 'secondary'],
    ['acknowledged', AMBER, 'warning'],
    ['investigating', AMBER, 'warning'],
    ['resolved', GREEN, 'success'],
    ['false_positive', GRAY, 'muted'],
    ['false-positive', GRAY, 'muted'],
    ['firing', RED, 'destructive'],
    ['ok', GREEN, 'success'],
    ['up', GREEN, 'success'],
    ['down', RED, 'destructive'],
    ['snoozed', GRAY, 'muted'],
    ['disabled', GRAY, 'muted'],
    ['pending', GRAY, 'secondary'],
    ['failed', RED, 'destructive'],
  ])('%s', (v, chart, token) => {
    expect(stateTone(v).chart).toBe(chart);
    expect(stateTone(v).badge).toContain(token);
  });

  it('up equals ok and down equals failed', () => {
    expect(stateTone('up')).toEqual(stateTone('ok'));
    expect(stateTone('down')).toEqual(stateTone('failed'));
  });
});

describe('palette rules', () => {
  it('open status and low severity are visually different', () => {
    expect(stateTone('open').badge).not.toBe(severityTone('low').badge);
  });

  it('high is red and medium is amber', () => {
    expect(severityTone('high').chart).toBe('#ef4444');
    expect(severityTone('medium').chart).toBe('#f59e0b');
  });

  it('only uses token classes, never raw palette classes', () => {
    const raw = /(red|blue|amber|green|purple|yellow|orange|gray|slate|zinc)-\d{2,3}/;
    const all = [
      ...['debug', 'info', 'warn', 'error', 'critical'].map(levelTone),
      ...['informational', 'low', 'medium', 'high', 'critical'].map(severityTone),
      ...['open', 'acknowledged', 'resolved', 'false_positive', 'firing', 'ok', 'up', 'down', 'snoozed', 'disabled', 'pending', 'failed'].map(stateTone),
    ];
    for (const t of all) {
      expect(`${t.badge} ${t.text} ${t.dot}`).not.toMatch(raw);
    }
  });
});

describe('aliases and case', () => {
  it('level aliases', () => {
    expect(levelTone('WARNING')).toEqual(levelTone('warn'));
    expect(levelTone('fatal')).toEqual(levelTone('critical'));
    expect(levelTone('Information')).toEqual(levelTone('info'));
    expect(levelTone('  Error ')).toEqual(levelTone('error'));
  });
  it('severity alias', () => {
    expect(severityTone('info')).toEqual(severityTone('informational'));
    expect(severityLabel('info')).toBe('Informational');
  });
});

describe('unknown values', () => {
  it('fall back to the neutral tone with a capitalised raw label', () => {
    expect(stateTone('weird_state')).toBe(NEUTRAL_TONE);
    expect(levelTone('nope')).toBe(NEUTRAL_TONE);
    expect(severityTone('zzz')).toBe(NEUTRAL_TONE);
    expect(stateLabel('weird_state')).toBe('Weird_state');
  });
  it('handles empty, null and undefined without throwing', () => {
    expect(stateTone('')).toBe(NEUTRAL_TONE);
    expect(stateLabel('')).toBe('Unknown');
    expect(levelLabel(undefined as any)).toBe('Unknown');
    expect(severityTone(null as any)).toBe(NEUTRAL_TONE);
  });
  it('does not resolve prototype keys', () => {
    expect(stateTone('constructor')).toBe(NEUTRAL_TONE);
    expect(stateTone('__proto__')).toBe(NEUTRAL_TONE);
  });
});

describe('labels', () => {
  it('uses sentence case', () => {
    expect(stateLabel('investigating')).toBe('Acknowledged');
    expect(stateLabel('acknowledged')).toBe('Acknowledged');
    expect(stateLabel('false_positive')).toBe('False positive');
    expect(stateLabel('false-positive')).toBe('False positive');
    expect(levelLabel('warn')).toBe('Warning');
    expect(levelLabel('WARNING')).toBe('Warning');
    expect(levelLabel('error')).toBe('Error');
    expect(severityLabel('high')).toBe('High');
    expect(stateLabel('open')).toBe('Open');
  });
});

describe('severityWeight', () => {
  it('orders informational to critical and returns 0 for unknown', () => {
    expect(severityWeight('informational')).toBe(1);
    expect(severityWeight('critical')).toBe(5);
    expect(severityWeight('HIGH')).toBe(4);
    expect(severityWeight('zzz')).toBe(0);
  });
});
