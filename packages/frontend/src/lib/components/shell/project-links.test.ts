import { describe, it, expect } from 'vitest';
import { projectQuickLinks, projectSwitchHref } from './project-links';

describe('projectQuickLinks', () => {
  it('returns the seven links in order with canonical hrefs', () => {
    expect(projectQuickLinks('p-1').map((l) => [l.label, l.href])).toEqual([
      ['Logs', '/dashboard/logs?project=p-1'],
      ['Traces', '/dashboard/traces?project=p-1'],
      ['Errors', '/dashboard/errors?project=p-1'],
      ['Metrics', '/dashboard/metrics?project=p-1'],
      ['Sessions', '/dashboard/sessions?project=p-1'],
      ['Web vitals', '/dashboard/web-vitals?project=p-1'],
      ['Uptime', '/dashboard/uptime?project=p-1'],
    ]);
  });

  it('url-encodes unsafe ids', () => {
    const [logs] = projectQuickLinks('a&b=c d');
    const params = new URL(logs.href, 'http://x').searchParams;
    expect(params.get('project')).toBe('a&b=c d');
    expect(logs.href).not.toContain(' ');
  });

  it('never emits the legacy projectId param', () => {
    for (const l of projectQuickLinks('p-1')) expect(l.href).not.toContain('projectId=');
  });
});

describe('projectSwitchHref', () => {
  const u = (path: string) => new URL('http://localhost' + path);

  it('swaps the route id and keeps the sub-page and query on project pages', () => {
    expect(projectSwitchHref(u('/dashboard/projects/p-1/settings?tab=keys'), 'p-2')).toBe('/dashboard/projects/p-2/settings?tab=keys');
    expect(projectSwitchHref(u('/dashboard/projects/p-1'), 'p-2')).toBe('/dashboard/projects/p-2');
  });

  it('rescopes other pages to the project and keeps the rest of the query', () => {
    const next = u(projectSwitchHref(u('/dashboard/logs?project=p-1&range=1h&q=level%3Aerror'), 'p-2'));
    expect(next.pathname).toBe('/dashboard/logs');
    expect(next.searchParams.get('project')).toBe('p-2');
    expect(next.searchParams.get('range')).toBe('1h');
    expect(next.searchParams.get('q')).toBe('level:error');
  });

  it('drops the legacy projectId parameter', () => {
    const next = u(projectSwitchHref(u('/dashboard/traces?projectId=p-1'), 'p-2'));
    expect(next.searchParams.has('projectId')).toBe(false);
    expect(next.searchParams.get('project')).toBe('p-2');
  });

  it('encodes the id in project routes', () => {
    expect(projectSwitchHref(u('/dashboard/projects/p-1/overview'), 'a/b')).toBe('/dashboard/projects/a%2Fb/overview');
  });
});
