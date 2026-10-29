import { describe, it, expect } from 'vitest';
import { exceptionPrefillFromDetection } from './exception-prefill';

describe('exceptionPrefillFromDetection', () => {
  it('uses service and the first scalar fields', () => {
    const out = exceptionPrefillFromDetection({
      service: 'api',
      projectId: 'p1',
      matchedFields: { user: 'bob', host: 'web-1', ip: '10.0.0.1' },
    });
    expect(out.conditions).toEqual([
      { field: 'service', operator: 'equals', values: ['api'] },
      { field: 'user', operator: 'equals', values: ['bob'] },
      { field: 'host', operator: 'equals', values: ['web-1'] },
    ]);
    expect(out.reason).toBe('Marked as false positive');
  });

  it('skips object values, long values and invalid field names', () => {
    const out = exceptionPrefillFromDetection({
      service: 'api',
      projectId: null,
      matchedFields: {
        nested: { a: 1 },
        list: ['x'],
        'bad field': 'v',
        long: 'x'.repeat(201),
        empty: '',
        ok: 'fine',
      },
    });
    expect(out.conditions.map((c) => c.field)).toEqual(['service', 'ok']);
  });

  it('works without matched fields or service', () => {
    const out = exceptionPrefillFromDetection({ service: '', projectId: null, matchedFields: null });
    expect(out.conditions).toEqual([]);
  });

  it('does not duplicate the service field', () => {
    const out = exceptionPrefillFromDetection({
      service: 'api',
      projectId: null,
      matchedFields: { service: 'api', a: 'b' },
    });
    expect(out.conditions.map((c) => c.field)).toEqual(['service', 'a']);
  });
});
