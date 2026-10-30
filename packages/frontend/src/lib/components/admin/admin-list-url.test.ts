import { describe, it, expect } from 'vitest';
import { buildListSearch, generatePassword, parseEnum, parsePage, parseSort } from './admin-list-url';

const def = { key: 'created_at', dir: 'desc' as const };

describe('admin list url helpers', () => {
  it('parses pages defensively', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage(null)).toBe(1);
  });

  it('parses enums with a fallback', () => {
    expect(parseEnum('admin', ['admin', 'user'] as const, '' as 'admin')).toBe('admin');
    expect(parseEnum('root', ['admin', 'user'] as const, 'user')).toBe('user');
  });

  it('parses sort only for allowed keys', () => {
    expect(parseSort(new URLSearchParams('sort=email&order=asc'), ['email'], def)).toEqual({ key: 'email', dir: 'asc' });
    expect(parseSort(new URLSearchParams('sort=email'), ['email'], def)).toEqual({ key: 'email', dir: 'desc' });
    expect(parseSort(new URLSearchParams('sort=bad&order=asc'), ['email'], def)).toEqual(def);
  });

  it('builds a clean search string', () => {
    expect(buildListSearch({ q: '', page: 1, sort: def, defaultSort: def, filters: {} })).toBe('');
    expect(
      buildListSearch({
        q: ' bob ',
        page: 2,
        sort: { key: 'email', dir: 'asc' },
        defaultSort: def,
        filters: { role: 'admin', status: '', deleted: 'exclude' },
        filterDefaults: { deleted: 'exclude' },
      }),
    ).toBe('?q=bob&role=admin&sort=email&order=asc&page=2');
  });

  it('generates passwords with every character class', () => {
    const p = generatePassword(16);
    expect(p).toHaveLength(16);
    expect(p).toMatch(/[a-z]/);
    expect(p).toMatch(/[A-Z]/);
    expect(p).toMatch(/[0-9]/);
    expect(p).toMatch(/[!@#$%^&*\-_=+]/);
  });
});
