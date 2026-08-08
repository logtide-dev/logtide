import type { GeoIpStep, LogForPipeline } from '../types.js';
import { buildGeoPlace } from '../geo-place.js';

// Lazy import to avoid crashing when GeoLite2 DB is not present
async function tryGeoLookup(ip: string): Promise<Record<string, unknown> | null> {
  try {
    const { geoLite2Service } = await import('../../siem/geolite2-service.js');
    const geo = geoLite2Service.lookup(ip);
    return geo ? (geo as unknown as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function runGeoIpStep(
  step: GeoIpStep,
  log: LogForPipeline
): Promise<Record<string, unknown>> {
  const meta = log.metadata ?? {};
  const ip = meta[step.field];
  if (typeof ip !== 'string' || !ip) return {};

  try {
    const geo = await tryGeoLookup(ip);
    if (!geo) return {};

    // Nested object (backward compatible) plus flat keys the dashboard geo map
    // panel can aggregate with reservoir.topValues, which resolves a single
    // JSON key on Timescale/ClickHouse and cannot address nested paths.
    const out: Record<string, unknown> = { [step.target]: geo };

    if (typeof geo.country === 'string' && geo.country) {
      out[`${step.target}_country`] = geo.country;
    }
    if (typeof geo.countryCode === 'string' && geo.countryCode) {
      out[`${step.target}_country_code`] = geo.countryCode;
    }
    if (typeof geo.city === 'string' && geo.city) {
      out[`${step.target}_city`] = geo.city;
    }
    if (
      typeof geo.latitude === 'number' &&
      typeof geo.longitude === 'number' &&
      typeof geo.country === 'string'
    ) {
      const place = buildGeoPlace({
        latitude: geo.latitude,
        longitude: geo.longitude,
        city: typeof geo.city === 'string' ? geo.city : null,
        country: geo.country,
      });
      if (place) out[`${step.target}_place`] = place;
    }

    return out;
  } catch {
    return {};
  }
}
