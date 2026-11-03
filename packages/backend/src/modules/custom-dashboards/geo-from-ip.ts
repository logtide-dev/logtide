// ============================================================================
// Geo map from client IPs
// ============================================================================
//
// The geo map panel reads the `<prefix>_country_code` / `<prefix>_place`
// metadata a GeoIP pipeline step writes at ingestion. Projects without that
// step still carry the client IP, so the panel can locate the IPs itself:
// the most frequent IPs of the range (one topValues group-by) are looked up
// in the local GeoLite2 database and their counts summed per country or place.
// Nothing is stored and nothing leaves the server.

import { isIP } from 'node:net';
import { buildGeoPlace, parseGeoPlace } from '../log-pipeline/geo-place.js';
import { COUNTRY_CENTROIDS } from './geo-centroids.js';

/** Metadata keys tried, in order, when the panel has no IP field set. */
export const IP_FIELD_CANDIDATES = [
  'client_ip',
  'clientIp',
  'ip',
  'remote_addr',
  'remote_ip',
  'source_ip',
  'src_ip',
  'ip_address',
  'x_forwarded_for',
] as const;

/** Same charset as reservoir's metadata key check; validated twice. */
export const IP_FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]{0,63}$/;

/** Distinct IPs located per request: the long tail beyond it is left out. */
export const GEO_IP_SAMPLE_LIMIT = 10_000;

export interface IpGeo {
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
}

export type IpGeoLookup = (ip: string) => IpGeo | null;

export interface GeoPoint {
  lat: number;
  lon: number;
  count: number;
  label: string;
  countryCode?: string;
}

/**
 * The client IP in a metadata value: a bare address, `ip:port`, `[v6]:port`,
 * or a forwarded-for list whose first entry is the client.
 */
export function firstIp(value: string): string | null {
  const first = value.split(',')[0]?.trim() ?? '';
  if (!first) return null;
  if (isIP(first)) return first;
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(first);
  if (bracketed && isIP(bracketed[1]) === 6) return bracketed[1];
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(first);
  if (withPort && isIP(withPort[1]) === 4) return withPort[1];
  return null;
}

/** The first candidate IP field present in the discovered metadata keys. */
export function pickIpField(discoveredKeys: Iterable<string>): string | null {
  const keys = new Set(discoveredKeys);
  return IP_FIELD_CANDIDATES.find((key) => keys.has(key)) ?? null;
}

/**
 * Sums IP counts per country (country mode) or per rounded location (points
 * mode, top `limit`). IPs that are not addresses or that the database cannot
 * place (private ranges, unknown) count in `total` and `droppedCount`.
 */
export function aggregateIpsToGeo(
  values: Array<{ value: string; count: number }>,
  mode: 'country' | 'points',
  limit: number,
  lookup: IpGeoLookup,
): { points: GeoPoint[]; total: number; droppedCount: number } {
  let total = 0;
  let droppedCount = 0;
  const groups = new Map<string, GeoPoint>();

  for (const { value, count } of values) {
    total += count;
    const ip = firstIp(value);
    const geo = ip ? lookup(ip) : null;
    const code = geo?.countryCode?.toUpperCase();
    if (!geo || !code || code === 'XX') {
      droppedCount++;
      continue;
    }

    if (mode === 'country') {
      const centroid = COUNTRY_CENTROIDS[code];
      if (!centroid) {
        droppedCount++;
        continue;
      }
      const point = groups.get(code);
      if (point) point.count += count;
      else groups.set(code, { lat: centroid.lat, lon: centroid.lon, count, label: centroid.name, countryCode: code });
      continue;
    }

    // Points: the same rounding and label as the pipeline's geo_place value.
    // An IP known only by country comes back at 0,0: place it on the country.
    const countryOnly = geo.latitude === 0 && geo.longitude === 0;
    const centroid = COUNTRY_CENTROIDS[code];
    if (countryOnly && !centroid) {
      droppedCount++;
      continue;
    }
    const place = buildGeoPlace(
      countryOnly
        ? { latitude: centroid.lat, longitude: centroid.lon, city: null, country: geo.country }
        : { latitude: geo.latitude, longitude: geo.longitude, city: geo.city, country: geo.country },
    );
    const parsed = place ? parseGeoPlace(place) : null;
    if (!place || !parsed) {
      droppedCount++;
      continue;
    }
    const point = groups.get(place);
    if (point) point.count += count;
    else groups.set(place, { lat: parsed.lat, lon: parsed.lon, count, label: parsed.label });
  }

  const points = [...groups.values()].sort((a, b) => b.count - a.count);
  return { points: mode === 'points' ? points.slice(0, limit) : points, total, droppedCount };
}
