import { describe, it, expect } from 'vitest';
import { legacyRedirect } from './legacy-routes';
import { GET as searchGet } from '../../routes/dashboard/search/+server';
import { GET as monitoringGet } from '../../routes/dashboard/monitoring/+server';
import { GET as monitorDetailGet } from '../../routes/dashboard/monitoring/[id]/+server';

describe('legacyRedirect', () => {
  it('answers 308 and keeps the query string verbatim', () => {
    const res = legacyRedirect(
      new URL('http://x/dashboard/search?q=a%20b&project=1&project=2'),
      '/dashboard/logs'
    );
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/logs?q=a%20b&project=1&project=2');
  });

  it('adds no question mark for an empty query', () => {
    const res = legacyRedirect(new URL('http://x/dashboard/search'), '/dashboard/logs');
    expect(res.headers.get('location')).toBe('/dashboard/logs');
    const bare = legacyRedirect(new URL('http://x/dashboard/search?'), '/dashboard/logs');
    expect(bare.headers.get('location')).toBe('/dashboard/logs');
  });

  it('never produces an absolute or protocol-relative location', () => {
    const res = legacyRedirect(
      new URL('http://x/dashboard/search?next=//evil.com'),
      '/dashboard/logs'
    );
    const loc = res.headers.get('location') as string;
    expect(loc.startsWith('//')).toBe(false);
    expect(loc.startsWith('/dashboard/logs?')).toBe(true);
    expect(loc.split('?')[0]).not.toContain('://');
  });
});

describe('legacy route handlers', () => {
  it('search goes to logs', () => {
    const res = searchGet({
      url: new URL('http://x/dashboard/search?live=true'),
      params: {},
    } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/logs?live=true');
  });

  it('monitoring list goes to uptime', () => {
    const res = monitoringGet({
      url: new URL('http://x/dashboard/monitoring'),
      params: {},
    } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/uptime');
  });

  it('monitor detail keeps an encoded id and the query', () => {
    const res = monitorDetailGet({
      url: new URL('http://x/dashboard/monitoring/a%2Fb%20c?tab=1'),
      params: { id: 'a/b c' },
    } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/uptime/a%2Fb%20c?tab=1');
  });
});
