import { describe, it, expect } from 'vitest';
import { GET } from './+server';

describe('account redirect', () => {
  it('returns 308 to the profile page and keeps ?x=1', () => {
    const res = (GET as (e: { url: URL }) => Response)({ url: new URL('http://x/dashboard/account?x=1') });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/dashboard/settings/account/profile?x=1');
  });
});
