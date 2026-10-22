import { describe, it, expect } from 'vitest';
import { packDestinationCopy } from './pack-copy';

describe('packDestinationCopy', () => {
  it('security copy says Security overview and incidents', () => {
    const c = packDestinationCopy('security');
    expect(c.where).toBe('Security overview');
    expect(c.createsIncidents).toBe(true);
    expect(c.summary).toContain('Security overview');
    expect(c.summary).toContain('incidents');
  });

  it('non security copy says Alerts history and no incidents', () => {
    for (const category of ['reliability', 'database', 'business'] as const) {
      const c = packDestinationCopy(category);
      expect(c.where).toBe('Alerts history');
      expect(c.createsIncidents).toBe(false);
      expect(c.summary).toContain('Alerts history');
      expect(c.summary).toContain('do not create incidents');
    }
  });
});
