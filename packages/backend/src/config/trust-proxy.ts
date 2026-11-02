import { isIP } from 'node:net';

/**
 * TRUST_PROXY: which hops in front of the backend may set X-Forwarded-For.
 *
 * - `false` (default): the client IP is the address of the connection.
 * - a number N: trust the N hops closest to the backend (for example 1 for a
 *   single reverse proxy, 2 for Cloudflare in front of it). The client IP is
 *   the address right before them, so a client cannot spoof it by sending
 *   its own X-Forwarded-For.
 * - a comma-separated list of IPs or CIDRs: trust those proxies only.
 * - `true`: trust every hop. The client IP becomes the left-most
 *   X-Forwarded-For entry, which the client controls; only use it when the
 *   proxy in front overwrites the header.
 */
export type TrustProxySetting = boolean | number | string[];

export function parseTrustProxy(raw: string): TrustProxySetting {
  const value = raw.trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > 32) throw new Error(`TRUST_PROXY hop count must be 1 to 32, got ${value}`);
    return hops;
  }
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = isIP(address);
    const prefixOk =
      prefix === undefined ||
      (/^\d+$/.test(prefix) && Number(prefix) <= (family === 6 ? 128 : 32));
    if (!family || !prefixOk || extra !== undefined) {
      throw new Error(`TRUST_PROXY must be true, false, a hop count or a list of IPs/CIDRs; "${entry}" is not valid`);
    }
  }
  return entries;
}

/** The Fastify `trustProxy` option for a setting (a hop count as the trust function Fastify itself builds). */
export function fastifyTrustProxy(
  setting: TrustProxySetting,
): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof setting === 'number') return (_address, hop) => hop < setting;
  return setting;
}
