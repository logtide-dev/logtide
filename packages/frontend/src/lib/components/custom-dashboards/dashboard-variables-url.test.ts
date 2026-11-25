import { describe, it, expect } from 'vitest';
import type { DashboardVariable } from '@logtide/shared';
import { readVariableValues, writeVariableValues } from './dashboard-variables-url';
import { validateVariables } from './variables-editor';

const v = (name: string, def: string | null = null, key = 'host.name'): DashboardVariable => ({
  name,
  label: name,
  attr: { scope: 'resource', key },
  metricName: null,
  default: def,
});

describe('dashboard variables url', () => {
  it('reads var-* params, empty value is All', () => {
    const url = new URL('http://x/dashboard?id=1&var-host=web-1&var-svc=&other=2');
    expect(readVariableValues(url)).toEqual({ host: 'web-1', svc: null });
  });

  it('ignores invalid names', () => {
    expect(readVariableValues(new URL('http://x/d?var-Bad=1&var-1x=2&var-=3'))).toEqual({});
  });

  it('writes only values that differ from the default and keeps other params', () => {
    const url = new URL('http://x/dashboard?id=abc&var-old=1');
    const next = writeVariableValues(url, [v('host'), v('svc', 'api')], { host: 'web-1', svc: 'api' });
    expect(next.searchParams.get('var-host')).toBe('web-1');
    expect(next.searchParams.has('var-svc')).toBe(false);
    expect(next.searchParams.has('var-old')).toBe(false);
    expect(next.searchParams.get('id')).toBe('abc');
  });

  it('writes an empty value when All is picked over a default', () => {
    const next = writeVariableValues(new URL('http://x/d'), [v('svc', 'api')], { svc: null });
    expect(next.searchParams.get('var-svc')).toBe('');
    expect(readVariableValues(next)).toEqual({ svc: null });
  });
});

describe('validateVariables', () => {
  it('accepts a valid list', () => {
    expect(validateVariables([v('host'), v('svc', null, 'service.name')])).toEqual([null, null]);
  });

  it('rejects bad names, duplicates and empty keys', () => {
    const res = validateVariables([v('Host'), v('a'), v('a'), v('b', null, ' ')]);
    expect(res[0]).toMatch(/Name must start/);
    expect(res[1]).toMatch(/already used/);
    expect(res[2]).toMatch(/already used/);
    expect(res[3]).toMatch(/attribute key/);
  });
});
