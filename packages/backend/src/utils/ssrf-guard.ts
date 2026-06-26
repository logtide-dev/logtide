/**
 * SSRF guard for outbound requests (HTTP monitors, TCP monitors, webhooks).
 *
 * Centralizes outbound target validation so an authenticated user can't point
 * the backend at internal services. It resolves hostnames and rejects loopback,
 * private, link-local (incl. cloud metadata), CGNAT, multicast, and reserved
 * IPv4/IPv6 ranges. HTTP redirects are followed manually and every hop is
 * revalidated. TCP connects are pinned to the validated address.
 *
 * Private/internal targets are blocked by default. Self-hosted deployments that
 * legitimately monitor internal services can opt back in with
 * MONITOR_ALLOW_PRIVATE_TARGETS=true (see config). The same flag governs webhook
 * delivery.
 */

import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { Agent, fetch as undiciFetch } from 'undici';

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/** True if an IPv4 dotted-quad falls in a loopback/private/reserved range. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed - fail closed
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  return false;
}

/** Strip an IPv6 zone id (fe80::1%eth0) and lower-case. */
function normalizeIpv6(ip: string): string {
  return ip.toLowerCase().split('%')[0];
}

/** True if an IPv6 address is loopback/unspecified/ULA/link-local/multicast or a blocked IPv4-mapped address. */
function isBlockedIpv6(ip: string): boolean {
  const addr = normalizeIpv6(ip);
  if (addr === '::1') return true; // loopback
  if (addr === '::') return true; // unspecified

  // IPv4-mapped: ::ffff:127.0.0.1
  const mappedDotted = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isBlockedIpv4(mappedDotted[1]);

  // IPv4-mapped hex form: ::ffff:7f00:0001
  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIpv4(v4);
  }

  const firstHextet = parseInt(addr.split(':')[0] || '0', 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True if a literal IP address is in a blocked range. Non-IP input fails closed. */
export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP literal - fail closed
}

/**
 * Resolve a hostname (or accept an IP literal) and return the validated
 * addresses. Throws SsrfBlockedError if any resolved address is blocked, unless
 * allowPrivate is set. Brackets around IPv6 literals are accepted.
 */
export async function resolveAndValidateHost(host: string, allowPrivate: boolean): Promise<string[]> {
  const cleaned = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  if (isIP(cleaned)) {
    if (!allowPrivate && isBlockedAddress(cleaned)) {
      throw new SsrfBlockedError(`Target address ${cleaned} is in a blocked range`);
    }
    return [cleaned];
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(cleaned, { all: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve host ${cleaned}`);
  }

  const addresses = resolved.map((r) => r.address);
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`Host ${cleaned} did not resolve to any address`);
  }

  if (!allowPrivate) {
    for (const address of addresses) {
      if (isBlockedAddress(address)) {
        throw new SsrfBlockedError(`Host ${cleaned} resolves to a blocked address (${address})`);
      }
    }
  }

  return addresses;
}

/** Validate that a URL is http(s) and its host resolves to an allowed address. */
export async function assertHttpTargetAllowed(rawUrl: string, allowPrivate: boolean): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError('Only http and https targets are allowed');
  }
  await resolveAndValidateHost(url.hostname, allowPrivate);
}

interface SafeFetchOptions {
  allowPrivate: boolean;
  maxRedirects?: number;
}

/**
 * Build a DNS lookup function that always resolves to the already-validated
 * `address`, regardless of the hostname asked. Handed to an undici Agent so the
 * socket connects to the exact IP we checked, closing the resolve-then-connect
 * (DNS rebinding) window. TLS SNI and certificate validation still use the
 * original hostname; only the destination IP is pinned.
 */
export function createPinnedLookup(address: string) {
  const family = isIP(address); // 4 or 6 (0 is rejected upstream as not-an-IP)
  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (options && options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

// Fetch implementation seam. Defaults to undici's fetch so we can attach a
// per-request dispatcher; overridable in tests via __setSafeFetchImpl.
type FetchImpl = (url: string | URL, init: Record<string, unknown>) => Promise<Response>;
let fetchImpl: FetchImpl = undiciFetch as unknown as FetchImpl;

/** @internal Test hook to stub the underlying fetch. Pass null to reset. */
export function __setSafeFetchImpl(fn: FetchImpl | null): void {
  fetchImpl = fn ?? (undiciFetch as unknown as FetchImpl);
}

/**
 * fetch() wrapper that validates the target before connecting and revalidates
 * every redirect hop instead of blindly following them. Each hop is resolved
 * and checked, and the connection is PINNED to the validated IP via a custom
 * undici dispatcher, which closes the resolve-then-connect (DNS rebinding)
 * window for both HTTP and HTTPS. TLS still uses the original hostname for SNI
 * and certificate validation.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit,
  options: SafeFetchOptions
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let url: URL;
    try {
      url = new URL(currentUrl);
    } catch {
      throw new SsrfBlockedError('Invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SsrfBlockedError('Only http and https targets are allowed');
    }
    const addresses = await resolveAndValidateHost(url.hostname, options.allowPrivate);

    // Pin the socket to the validated address so a hostname that re-resolves to
    // an internal IP between validation and connect cannot be reached.
    const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(addresses[0]) } });

    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, redirect: 'manual', dispatcher });
    } catch (err) {
      void dispatcher.close().catch(() => {});
      throw err;
    }
    // Gracefully close the per-hop dispatcher once the request completes; this
    // does not abort the body the caller is about to read.
    void dispatcher.close().catch(() => {});

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = isRedirect ? response.headers?.get('location') ?? null : null;
    if (isRedirect && location) {
      // Discard the redirect body and revalidate the next hop.
      await response.body?.cancel?.().catch(() => {});
      currentUrl = new URL(location, url).toString();
      continue;
    }

    return response;
  }

  throw new SsrfBlockedError('Too many redirects');
}
