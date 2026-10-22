import { describe, it, expect } from 'vitest';
import { logLink } from './log-link';

describe('logLink', () => {
  it('carries a five minute window around the time', () => {
    const url = new URL(
      logLink({ logId: 'l1', projectId: 'p1', time: '2026-10-20T10:00:00.000Z' }),
      'http://x',
    );
    expect(url.pathname).toBe('/dashboard/logs');
    expect(url.searchParams.get('logId')).toBe('l1');
    expect(url.searchParams.get('project')).toBe('p1');
    expect(url.searchParams.get('from')).toBe('2026-10-20T09:55:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-10-20T10:05:00.000Z');
  });

  it('omits project when null', () => {
    const url = new URL(
      logLink({ logId: 'l1', projectId: null, time: '2026-10-20T10:00:00.000Z' }),
      'http://x',
    );
    expect(url.searchParams.has('project')).toBe(false);
  });

  it('omits the window for an unparsable time', () => {
    const url = new URL(logLink({ logId: 'l1', time: 'nope' }), 'http://x');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
  });
});
