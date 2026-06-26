import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isBlockedAddress,
  resolveAndValidateHost,
  assertHttpTargetAllowed,
  safeFetch,
  createPinnedLookup,
  __setSafeFetchImpl,
  SsrfBlockedError,
} from '../../utils/ssrf-guard.js';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT and reserved IPv4', () => {
    const blocked = [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '0.0.0.0',
      '224.0.0.1', // multicast
      '255.255.255.255',
    ];
    for (const ip of blocked) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.63.255.255'];
    for (const ip of allowed) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('blocks loopback, ULA, link-local, multicast and mapped IPv6', () => {
    const blocked = [
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ];
    for (const ip of blocked) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('fails closed for non-IP input', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('resolveAndValidateHost (IP literals)', () => {
  it('throws for a blocked literal address', async () => {
    await expect(resolveAndValidateHost('127.0.0.1', false)).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(resolveAndValidateHost('169.254.169.254', false)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('returns a public literal address unchanged', async () => {
    await expect(resolveAndValidateHost('8.8.8.8', false)).resolves.toEqual(['8.8.8.8']);
  });

  it('allows blocked addresses when allowPrivate is set', async () => {
    await expect(resolveAndValidateHost('10.0.0.5', true)).resolves.toEqual(['10.0.0.5']);
  });

  it('accepts bracketed IPv6 literals', async () => {
    await expect(resolveAndValidateHost('[::1]', false)).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe('assertHttpTargetAllowed', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertHttpTargetAllowed('ftp://example.com', false)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('rejects a literal internal target', async () => {
    await expect(assertHttpTargetAllowed('http://127.0.0.1/health', false)).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('allows an internal target when allowPrivate is set', async () => {
    await expect(assertHttpTargetAllowed('http://10.0.0.5/health', true)).resolves.toBeUndefined();
  });
});

describe('createPinnedLookup (DNS rebinding protection)', () => {
  it('always returns the pinned address regardless of the hostname asked', () => {
    const lookup = createPinnedLookup('93.184.216.34');
    let got: { address: string; family?: number } | undefined;
    lookup('evil.example.com', {}, (_err, address, family) => {
      got = { address: address as string, family };
    });
    expect(got).toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('supports the { all: true } array form with the correct family', () => {
    const lookup = createPinnedLookup('2606:4700:4700::1111');
    let got: unknown;
    lookup('evil.example.com', { all: true }, (_err, list) => {
      got = list;
    });
    expect(got).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
  });
});

describe('safeFetch redirect revalidation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __setSafeFetchImpl(null);
  });

  function res(status: number, location?: string) {
    return {
      status,
      headers: { get: (k: string) => (k.toLowerCase() === 'location' ? location ?? null : null) },
      body: { cancel: () => Promise.resolve() },
    } as unknown as Response;
  }

  it('follows a redirect to an allowed host and revalidates each hop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(302, 'http://1.1.1.1/next'))
      .mockResolvedValueOnce(res(200));
    __setSafeFetchImpl(fetchMock as any);

    const result = await safeFetch('http://8.8.8.8/start', {}, { allowPrivate: false });
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('passes a pinning dispatcher to the underlying fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(200));
    __setSafeFetchImpl(fetchMock as any);

    await safeFetch('http://8.8.8.8/start', {}, { allowPrivate: false });
    const init = fetchMock.mock.calls[0][1];
    expect(init.dispatcher).toBeDefined();
    expect(init.redirect).toBe('manual');
  });

  it('blocks a redirect that points at an internal address', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(302, 'http://169.254.169.254/latest/meta-data'));
    __setSafeFetchImpl(fetchMock as any);

    await expect(safeFetch('http://8.8.8.8/start', {}, { allowPrivate: false })).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });

  it('stops after too many redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(302, 'http://1.1.1.1/loop'));
    __setSafeFetchImpl(fetchMock as any);

    await expect(safeFetch('http://8.8.8.8/start', {}, { allowPrivate: false, maxRedirects: 2 })).rejects.toBeInstanceOf(
      SsrfBlockedError
    );
  });
});
