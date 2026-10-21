import { describe, it, expect } from 'vitest';
import { sectionListPath } from './section-path';

describe('sectionListPath', () => {
  const table: [string, string][] = [
    ['/dashboard/errors/abc', '/dashboard/errors'],
    ['/dashboard/traces/abc', '/dashboard/traces'],
    ['/dashboard/uptime/abc', '/dashboard/uptime'],
    ['/dashboard/incidents/abc', '/dashboard/incidents'],
    ['/dashboard/sessions/abc', '/dashboard/sessions'],
    ['/dashboard/projects/abc/overview', '/dashboard/projects'],
    ['/dashboard/security/rules/abc', '/dashboard/security/rules'],
    ['/dashboard/security/incidents/abc', '/dashboard/incidents'],
    ['/dashboard/logs', '/dashboard/logs'],
    ['/dashboard/settings/members', '/dashboard/settings/members'],
    ['/dashboard/admin/users', '/dashboard/admin/users'],
    ['/dashboard/account', '/dashboard/account'],
    ['/dashboard/unknown/xyz', '/dashboard'],
    ['/dashboard', '/dashboard'],
    ['/dashboard/logs/', '/dashboard/logs'],
  ];

  for (const [input, output] of table) {
    it(`${input} -> ${output}`, () => {
      expect(sectionListPath(input)).toBe(output);
    });
  }

  it('ignores a query string or hash in the input', () => {
    expect(sectionListPath('/dashboard/errors/abc?x=1#y')).toBe('/dashboard/errors');
  });
});
