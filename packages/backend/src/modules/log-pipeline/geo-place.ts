// ============================================================================
// geo_place metadata value format
// ============================================================================
//
// The geoip pipeline step writes a `<target>_place` flat metadata key whose
// value packs rounded coordinates and a human label into one string:
//
//   "41.90,12.50|Rome, Italy"
//
// One string means the geo map panel's points mode is a single topValues
// group-by (no raw-row scanning). Coordinates are rounded to 2 decimals
// (~1 km) BEFORE formatting, so equal locations always produce the same
// string and cardinality stays bounded.
//
// parseGeoPlace treats input as untrusted: any client can write arbitrary
// strings under this metadata key, so everything is validated and invalid
// values yield null (callers drop and count them).

const MAX_LABEL_LENGTH = 80;

export interface GeoPlaceInput {
  latitude: number;
  longitude: number;
  city: string | null;
  country: string;
}

export function buildGeoPlace(geo: GeoPlaceInput): string | null {
  if (!Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)) return null;

  const lat = geo.latitude.toFixed(2);
  const lon = geo.longitude.toFixed(2);
  const city = geo.city ? geo.city.replaceAll('|', '') : null;
  const country = geo.country.replaceAll('|', '');
  const label = city ? `${city}, ${country}` : country;
  return `${lat},${lon}|${label}`;
}

export function parseGeoPlace(
  value: string
): { lat: number; lon: number; label: string } | null {
  const sep = value.indexOf('|');
  if (sep <= 0) return null;

  const coords = value.slice(0, sep).split(',');
  if (coords.length !== 2) return null;

  const lat = Number(coords[0]);
  const lon = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const label = value.slice(sep + 1, sep + 1 + MAX_LABEL_LENGTH);
  return { lat, lon, label };
}
