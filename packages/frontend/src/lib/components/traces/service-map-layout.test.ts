import { describe, it, expect } from 'vitest';
import { stableNodePositions } from './service-map-layout';

describe('stableNodePositions', () => {
  it('is deterministic and independent of input order', () => {
    const a = stableNodePositions(['web', 'api', 'db', 'cache'], 800, 500);
    const b = stableNodePositions(['cache', 'db', 'web', 'api'], 800, 500);
    for (const name of ['web', 'api', 'db', 'cache']) {
      expect(a.get(name)).toEqual(b.get(name));
    }
    expect(stableNodePositions(['web', 'api'], 800, 500)).toEqual(stableNodePositions(['web', 'api'], 800, 500));
  });

  it('positions are finite and inside the box', () => {
    const names = Array.from({ length: 12 }, (_, i) => `svc ${i} "q" ü`);
    const positions = stableNodePositions(names, 600, 400);
    expect(positions.size).toBe(12);
    for (const { x, y } of positions.values()) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(600);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(400);
    }
  });

  it('a single node is placed at the centre', () => {
    expect(stableNodePositions(['only'], 800, 400).get('only')).toEqual({ x: 400, y: 200 });
  });

  it('falls back to a default box for a zero-size container', () => {
    const p = stableNodePositions(['a', 'b'], 0, 0);
    for (const { x, y } of p.values()) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });
});
