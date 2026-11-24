import { BlockList, isIP } from 'node:net';

/**
 * API key allowlist: entries are origins (`https://app.example.com`),
 * hostnames (`example.com`, `*.example.com`), IP addresses or CIDR ranges
 * (`203.0.113.7`, `203.0.113.0/24`, `2001:db8::/64`).
 */

const MAPPED_V4_PREFIX = '::ffff:';

/** Canonical form of an address: no brackets, no zone, IPv4-mapped IPv6 as plain IPv4. */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith(MAPPED_V4_PREFIX) && isIP(ip.slice(MAPPED_V4_PREFIX.length)) === 4) {
    return ip.slice(MAPPED_V4_PREFIX.length);
  }
  return ip;
}

interface IpEntry {
  address: string;
  family: 4 | 6;
  prefix: number | null;
}

/** Parse an entry as an IP or CIDR; null when it is something else (origin, hostname) or malformed. */
function parseIpEntry(entry: string): IpEntry | null {
  const parts = entry.trim().split('/');
  if (parts.length > 2) return null;
  const address = normalizeIp(parts[0]);
  const family = isIP(address);
  if (family !== 4 && family !== 6) return null;
  if (parts.length === 1) return { address, family, prefix: null };
  if (!/^\d{1,3}$/.test(parts[1])) return null;
  const prefix = Number(parts[1]);
  if (prefix > (family === 6 ? 128 : 32)) return null;
  return { address, family, prefix };
}

function ipEntryMatches(entry: IpEntry, ip: string): boolean {
  if (isIP(ip) !== entry.family) return false;
  const type = entry.family === 6 ? 'ipv6' : 'ipv4';
  const list = new BlockList();
  if (entry.prefix === null) list.addAddress(entry.address, type);
  else list.addSubnet(entry.address, entry.prefix, type);
  return list.check(ip, type);
}

function originEntryMatches(entry: string, origin: string, hostname: string): boolean {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(2);
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }
  // Exact origin (https://example.com) or hostname only (example.com)
  return origin === entry || hostname === entry;
}

/**
 * True when the request may use the key.
 *
 * - no allowlist: always allowed
 * - the Origin header (browsers) is matched against origin and hostname entries
 * - the client IP is matched against IP and CIDR entries, with or without an
 *   Origin header
 */
export function isAllowedByAllowlist(
  allowed: string[] | null | undefined,
  origin: string | undefined,
  ip: string | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  const entries = allowed.map((entry) => entry.trim()).filter(Boolean);

  if (origin) {
    let hostname: string | null = null;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      hostname = null;
    }
    if (hostname !== null && entries.some((entry) => originEntryMatches(entry, origin, hostname))) {
      return true;
    }
  }

  if (!ip) return false;
  const clientIp = normalizeIp(ip);
  return entries.some((entry) => {
    const parsed = parseIpEntry(entry);
    return parsed !== null && ipEntryMatches(parsed, clientIp);
  });
}

/**
 * Reject entries that can never match: something that looks like an IP range
 * (an address followed by a slash) but is not a valid CIDR.
 */
export function isValidAllowlistEntry(raw: string): boolean {
  const entry = raw.trim();
  if (!entry.includes('/') || entry.includes('://')) return true;
  const address = normalizeIp(entry.split('/')[0]);
  if (!isIP(address)) return true;
  return parseIpEntry(entry) !== null;
}
