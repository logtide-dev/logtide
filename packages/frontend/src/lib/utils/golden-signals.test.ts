import { describe, it, expect } from 'vitest';
import { SIGNAL_CONFIGS } from './golden-signals';
import { levelTone, stateTone } from './severity';

const byType = (type: string) => SIGNAL_CONFIGS.find((c) => c.type === type)!;

describe('golden signal series colours', () => {
  it('error series uses the severity error colour', () => {
    expect(byType('error_rate').aggregations[0].color).toBe(levelTone('error').chart);
  });

  it('latency series use the shared ok, warn and error colours', () => {
    const [p50, p95, p99] = byType('latency').aggregations;
    expect(p50.color).toBe(stateTone('ok').chart);
    expect(p95.color).toBe(levelTone('warn').chart);
    expect(p99.color).toBe(levelTone('error').chart);
  });
});
