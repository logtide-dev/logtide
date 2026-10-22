import { describe, it, expect } from 'vitest';
import { projectQuickLinks } from './project-links';

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
