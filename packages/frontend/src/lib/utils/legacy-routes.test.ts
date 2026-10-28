import { describe, it, expect } from 'vitest';
import {
  legacyRedirect,
  sessionsRedirectTarget,
  sessionDetailRedirectTarget,
  webVitalsRedirectTarget,
} from './legacy-routes';
import { GET as sessionsGet } from '../../routes/dashboard/projects/[id]/sessions/+server';
import { GET as sessionDetailGet } from '../../routes/dashboard/projects/[id]/sessions/[sessionId]/+server';
import { GET as performanceGet } from '../../routes/dashboard/projects/[id]/performance/+server';
import { GET as overviewGet } from '../../routes/dashboard/projects/[id]/overview/+server';
import { GET as projectAlertsGet } from '../../routes/dashboard/projects/[id]/alerts/+server';
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

describe('project route redirect targets', () => {
  it('preserves unrelated query params', () => {
    expect(sessionsRedirectTarget('p1', '?errors=1&x=1')).toBe('/dashboard/sessions?project=p1&errors=1&x=1');
    expect(webVitalsRedirectTarget('p1', '?range=7d')).toBe('/dashboard/web-vitals?project=p1&range=7d');
  });

  it('path id wins over project param', () => {
    expect(sessionsRedirectTarget('p1', '?project=other&projectId=other2&x=1')).toBe(
      '/dashboard/sessions?project=p1&x=1',
    );
  });

  it('encodes session id', () => {
    expect(sessionDetailRedirectTarget('p1', 'a b/c', '')).toBe('/dashboard/sessions/a%20b%2Fc?project=p1');
  });

  it('no search yields clean url', () => {
    expect(sessionsRedirectTarget('p1', '')).toBe('/dashboard/sessions?project=p1');
    expect(webVitalsRedirectTarget('p1', '?')).toBe('/dashboard/web-vitals?project=p1');
  });

  it('server handlers answer 308 with the built target', () => {
    const res = sessionsGet({ params: { id: 'p1' }, url: new URL('http://x/a?x=1') } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/sessions?project=p1&x=1');
    const d = sessionDetailGet({
      params: { id: 'p1', sessionId: 's 1' },
      url: new URL('http://x/a'),
    } as never) as Response;
    expect(d.headers.get('location')).toBe('/dashboard/sessions/s%201?project=p1');
    const w = performanceGet({ params: { id: 'p1' }, url: new URL('http://x/a') } as never) as Response;
    expect(w.headers.get('location')).toBe('/dashboard/web-vitals?project=p1');
  });
});

describe('project overview and alerts redirects', () => {
  it('overview goes to the project page and keeps the query', () => {
    const res = overviewGet({ params: { id: 'p1' }, url: new URL('http://x/a?x=1') } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/projects/p1?x=1');
  });

  it('alerts goes to the global alerts page scoped to the project', () => {
    const res = projectAlertsGet({ params: { id: 'p1' }, url: new URL('http://x/a?tab=rules') } as never) as Response;
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/alerts?project=p1&tab=rules');
  });
});
