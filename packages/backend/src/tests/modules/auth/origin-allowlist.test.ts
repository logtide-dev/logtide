import { describe, it, expect } from 'vitest';
import {
  isAllowedByAllowlist,
  isValidAllowlistEntry,
  normalizeIp,
} from '../../../modules/auth/origin-allowlist.js';

describe('normalizeIp', () => {
  it('turns IPv4-mapped IPv6 into plain IPv4', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('drops brackets and zone ids, lowercases', () => {
    expect(normalizeIp('[2001:DB8::1]')).toBe('2001:db8::1');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
  });
});

describe('isAllowedByAllowlist', () => {
  it('allows everything without an allowlist', () => {
    expect(isAllowedByAllowlist(null, undefined, '203.0.113.7')).toBe(true);
    expect(isAllowedByAllowlist([], 'https://x.example', undefined)).toBe(true);
  });

  it('matches an exact IPv4 address', () => {
    expect(isAllowedByAllowlist(['203.0.113.7'], undefined, '203.0.113.7')).toBe(true);
    expect(isAllowedByAllowlist(['203.0.113.7'], undefined, '203.0.113.8')).toBe(false);
  });

  it('matches a plain IPv4 entry against an IPv4-mapped client address and the other way round', () => {
    expect(isAllowedByAllowlist(['203.0.113.7'], undefined, '::ffff:203.0.113.7')).toBe(true);
    expect(isAllowedByAllowlist(['::ffff:203.0.113.7'], undefined, '203.0.113.7')).toBe(true);
  });

  it('matches IPv4 CIDR ranges', () => {
    expect(isAllowedByAllowlist(['203.0.113.0/24'], undefined, '203.0.113.200')).toBe(true);
    expect(isAllowedByAllowlist(['203.0.113.0/24'], undefined, '203.0.114.1')).toBe(false);
    expect(isAllowedByAllowlist(['203.0.113.0/24'], undefined, '::ffff:203.0.113.9')).toBe(true);
  });

  it('matches IPv6 addresses whatever their spelling', () => {
    expect(isAllowedByAllowlist(['2001:db8:0:0:0:0:0:1'], undefined, '2001:db8::1')).toBe(true);
    expect(isAllowedByAllowlist(['2001:DB8::1'], undefined, '2001:db8::1')).toBe(true);
    expect(isAllowedByAllowlist(['2001:db8::1'], undefined, '2001:db8::2')).toBe(false);
  });

  it('matches IPv6 CIDR ranges', () => {
    expect(isAllowedByAllowlist(['2001:db8:abcd:12::/64'], undefined, '2001:db8:abcd:12:1:2:3:4')).toBe(true);
    expect(isAllowedByAllowlist(['2001:db8:abcd:12::/64'], undefined, '2001:db8:abcd:13::1')).toBe(false);
  });

  it('never matches across address families', () => {
    expect(isAllowedByAllowlist(['203.0.113.0/24'], undefined, '2001:db8::1')).toBe(false);
    expect(isAllowedByAllowlist(['::/0'], undefined, '203.0.113.7')).toBe(false);
  });

  it('ignores malformed ranges instead of matching', () => {
    expect(isAllowedByAllowlist(['203.0.113.0/40'], undefined, '203.0.113.7')).toBe(false);
    expect(isAllowedByAllowlist(['203.0.113.0/'], undefined, '203.0.113.7')).toBe(false);
    expect(isAllowedByAllowlist(['203.0.113.0/24/1'], undefined, '203.0.113.7')).toBe(false);
  });

  it('trims entries', () => {
    expect(isAllowedByAllowlist(['  203.0.113.7 '], undefined, '203.0.113.7')).toBe(true);
  });

  it('matches origins and hostnames as before', () => {
    expect(isAllowedByAllowlist(['https://myapp.com'], 'https://myapp.com', '198.51.100.1')).toBe(true);
    expect(isAllowedByAllowlist(['myapp.com'], 'https://myapp.com', '198.51.100.1')).toBe(true);
    expect(isAllowedByAllowlist(['*.example.com'], 'https://a.b.example.com', '198.51.100.1')).toBe(true);
    expect(isAllowedByAllowlist(['*.example.com'], 'https://example.com', '198.51.100.1')).toBe(true);
    expect(isAllowedByAllowlist(['*.example.com'], 'https://evil.com', '198.51.100.1')).toBe(false);
    expect(isAllowedByAllowlist(['https://myapp.com'], 'not a url', '198.51.100.1')).toBe(false);
  });

  it('allows a listed IP even when the request carries an unlisted Origin', () => {
    expect(isAllowedByAllowlist(['203.0.113.7'], 'https://other.example', '203.0.113.7')).toBe(true);
    expect(isAllowedByAllowlist(['203.0.113.7'], 'https://other.example', '203.0.113.8')).toBe(false);
  });

  it('rejects when there is no origin and no IP', () => {
    expect(isAllowedByAllowlist(['203.0.113.7'], undefined, undefined)).toBe(false);
  });
});

describe('isValidAllowlistEntry', () => {
  it('accepts origins, hostnames, addresses and valid ranges', () => {
    for (const entry of [
      'https://app.example.com',
      'https://app.example.com/',
      'example.com',
      '*.example.com',
      '203.0.113.7',
      '203.0.113.0/24',
      '2001:db8::1',
      '2001:db8::/64',
    ]) {
      expect(isValidAllowlistEntry(entry), entry).toBe(true);
    }
  });

  it('rejects ranges that could never match', () => {
    for (const entry of ['203.0.113.0/40', '203.0.113.0/', '2001:db8::/129', '203.0.113.0/24/1', '203.0.113.0/x']) {
      expect(isValidAllowlistEntry(entry), entry).toBe(false);
    }
  });
});
