import { describe, it, expect } from 'vitest';
import { genericAdapter, getPath } from '../../../modules/receivers/adapters/generic.js';
import type { AdapterReceiverInfo } from '../../../modules/receivers/adapters/types.js';

function receiver(fieldMapping: AdapterReceiverInfo['fieldMapping'] = null): AdapterReceiverInfo {
  return { id: 'r-1', name: 'my receiver', adapterType: 'generic', fieldMapping };
}

describe('getPath', () => {
  it('resolves nested dot paths', () => {
    expect(getPath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });
  it('returns undefined for missing segments and non-objects', () => {
    expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(getPath(null, 'a')).toBeUndefined();
  });
});

describe('genericAdapter', () => {
  it('maps fields via dot paths', () => {
    const result = genericAdapter(
      { sev: 'ERROR', txt: 'disk full', app: 'billing', ts: '2026-07-01T10:00:00Z' },
      receiver({ message: 'txt', level: 'sev', service: 'app', timestamp: 'ts' })
    );
    expect(result.kind).toBe('logs');
    if (result.kind !== 'logs') return;
    expect(result.logs).toHaveLength(1);
    const log = result.logs[0];
    expect(log.message).toBe('disk full');
    expect(log.level).toBe('error');
    expect(log.service).toBe('billing');
    expect(log.time).toBe('2026-07-01T10:00:00.000Z');
    expect((log.metadata as any).payload.txt).toBe('disk full');
  });

  it('applies levelMap before builtin coercion', () => {
    const result = genericAdapter(
      { sev: 'CRIT', txt: 'x' },
      receiver({ message: 'txt', level: 'sev', levelMap: { crit: 'critical' } })
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('critical');
  });

  it('coerces common synonyms (warning, fatal)', () => {
    const r1 = genericAdapter({ l: 'WARNING' }, receiver({ level: 'l' }));
    const r2 = genericAdapter({ l: 'fatal' }, receiver({ level: 'l' }));
    if (r1.kind !== 'logs' || r2.kind !== 'logs') throw new Error('expected logs');
    expect(r1.logs[0].level).toBe('warn');
    expect(r2.logs[0].level).toBe('critical');
  });

  it('falls back to defaults and receiver name without mapping', () => {
    const result = genericAdapter({ anything: true }, receiver(null));
    if (result.kind !== 'logs') throw new Error('expected logs');
    const log = result.logs[0];
    expect(log.message).toBe('Received event');
    expect(log.level).toBe('info');
    expect(log.service).toBe('my receiver');
  });

  it('uses configured defaults over builtin fallbacks', () => {
    const result = genericAdapter(
      {},
      receiver({ defaults: { level: 'warn', service: 'ext' } })
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('warn');
    expect(result.logs[0].service).toBe('ext');
  });

  it('ignores unparseable timestamps', () => {
    const result = genericAdapter({ ts: 'not-a-date' }, receiver({ timestamp: 'ts' }));
    if (result.kind !== 'logs') throw new Error('expected logs');
    // falls back to "now": still a valid ISO string
    expect(new Date(result.logs[0].time as string).getTime()).not.toBeNaN();
  });

  it('truncates service to 100 chars', () => {
    const result = genericAdapter({ s: 'x'.repeat(200) }, receiver({ service: 's' }));
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect((result.logs[0].service as string).length).toBe(100);
  });
});
