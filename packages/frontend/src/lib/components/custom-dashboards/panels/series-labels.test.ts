import { describe, it, expect } from 'vitest';
import { resolveSeriesLabel } from './series-labels';

describe('resolveSeriesLabel', () => {
  it('falls back to canonical labels when no overrides', () => {
    expect(resolveSeriesLabel('info')).toBe('Info');
    expect(resolveSeriesLabel('critical', {})).toBe('Critical');
  });

  it('uses the custom label when set', () => {
    expect(resolveSeriesLabel('info', { info: 'Heartbeat' })).toBe('Heartbeat');
    expect(resolveSeriesLabel('error', { info: 'Heartbeat', error: 'Blocked' })).toBe('Blocked');
  });

  it('ignores whitespace-only labels', () => {
    expect(resolveSeriesLabel('warn', { warn: '   ' })).toBe('Warn');
  });
});
