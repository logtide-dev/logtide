import { describe, it, expect } from 'vitest';
import { GET as listGet } from './+server';
import { GET as detailGet } from './[id]/+server';

function list(qs: string) {
  const url = new URL(`http://x/dashboard/security/incidents${qs}`);
  return listGet({ url } as never) as Response;
}

describe('security incidents redirects', () => {
  it('list redirect adds source=sigma and preserves status, severity, service, technique, ruleId', () => {
    const res = list('?status=open&status=investigating&severity=high&service=api&technique=T1110&ruleId=r1');
    expect(res.status).toBe(308);
    const loc = new URL(res.headers.get('location') as string, 'http://x');
    expect(loc.pathname).toBe('/dashboard/incidents');
    expect(loc.searchParams.getAll('status')).toEqual(['open', 'investigating']);
    expect(loc.searchParams.get('severity')).toBe('high');
    expect(loc.searchParams.get('service')).toBe('api');
    expect(loc.searchParams.get('technique')).toBe('T1110');
    expect(loc.searchParams.get('ruleId')).toBe('r1');
    expect(loc.searchParams.get('source')).toBe('sigma');
  });

  it('list redirect with no query still adds source=sigma', () => {
    const res = list('');
    expect(res.headers.get('location')).toBe('/dashboard/incidents?source=sigma');
  });

  it('list redirect does not duplicate an existing source', () => {
    const res = list('?source=alert');
    const loc = new URL(res.headers.get('location') as string, 'http://x');
    expect(loc.searchParams.getAll('source')).toEqual(['alert']);
  });

  it('detail redirect preserves id and query', () => {
    const url = new URL('http://x/dashboard/security/incidents/abc-1?project=p1');
    const res = detailGet({ url, params: { id: 'abc-1' } } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/incidents/abc-1?project=p1');
  });

  it('detail redirect encodes the id so it cannot escape the path', () => {
    const url = new URL('http://x/dashboard/security/incidents/x');
    const res = detailGet({ url, params: { id: '../evil?x' } } as never) as Response;
    expect(res.headers.get('location')).toBe('/dashboard/incidents/..%2Fevil%3Fx');
  });
});
