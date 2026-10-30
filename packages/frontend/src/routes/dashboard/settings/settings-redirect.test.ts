import { describe, it, expect } from 'vitest';
import { GET } from './+server';

describe('settings index redirect', () => {
  it('returns a 308 to general and preserves the query string', () => {
    const res = (GET as (e: { url: URL }) => Response)({ url: new URL('http://x/dashboard/settings?x=1&y=2') });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/settings/general?x=1&y=2');
  });

  it('returns a bare target when there is no query', () => {
    const res = (GET as (e: { url: URL }) => Response)({ url: new URL('http://x/dashboard/settings') });
    expect(res.headers.get('location')).toBe('/dashboard/settings/general');
  });
});
