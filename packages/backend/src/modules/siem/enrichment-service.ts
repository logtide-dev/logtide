import { geoLite2Service } from './geolite2-service.js';
import { ipsumService } from './ipsum-service.js';
import type { IpReputationData, GeoIpData } from './types';

export class EnrichmentService {
  /**
   * Initialize the enrichment service
   * This should be called at application startup
   */
  async initialize(): Promise<void> {
    console.log('[EnrichmentService] Initializing...');

    // Initialize GeoLite2 database (downloads from GitHub mirror if needed)
    const geoReady = await geoLite2Service.initialize();
    if (geoReady) {
      console.log('[EnrichmentService] GeoLite2 ready');
    } else {
      console.warn('[EnrichmentService] GeoLite2 not available - check network connection');
    }

    // Initialize IPsum database (downloads from GitHub if needed)
    const ipsumReady = await ipsumService.initialize();
    if (ipsumReady) {
      console.log('[EnrichmentService] IPsum ready');
    } else {
      console.warn('[EnrichmentService] IPsum not available - check network connection');
    }
  }

  /**
   * Update databases if needed (call daily from worker)
   */
  async updateDatabasesIfNeeded(): Promise<{ geoLite2: boolean; ipsum: boolean }> {
    const results = { geoLite2: false, ipsum: false };

    if (geoLite2Service.needsUpdate()) {
      console.log('[EnrichmentService] GeoLite2 database needs update');
      results.geoLite2 = await geoLite2Service.downloadDatabase();
    }

    if (ipsumService.needsUpdate()) {
      console.log('[EnrichmentService] IPsum database needs update');
      results.ipsum = await ipsumService.downloadDatabase();
    }

    return results;
  }

  /**
   * Check IP reputation using local IPsum database
   * No API calls - instant local lookup
   */
  checkIpReputation(ip: string): IpReputationData | null {
    if (!ipsumService.ready()) {
      console.warn('[EnrichmentService] IPsum not ready');
      return null;
    }

    const result = ipsumService.checkIp(ip);

    return {
      ip: result.ip,
      reputation: result.reputation,
      abuseConfidenceScore: result.score * 10, // Convert to 0-100 scale (approx)
      source: 'IPsum',
      lastChecked: result.lastChecked,
    };
  }

  /**
   * Batch check multiple IPs
   */
  checkIpReputationBatch(ips: string[]): Record<string, IpReputationData | null> {
    const results: Record<string, IpReputationData | null> = {};
    for (const ip of ips) {
      results[ip] = this.checkIpReputation(ip);
    }
    return results;
  }

  /**
   * Get geographic information for an IP using local GeoLite2 database
   */
  getGeoIpData(ip: string): GeoIpData | null {
    const data = geoLite2Service.lookup(ip);
    if (!data) return null;

    return {
      ip: data.ip,
      country: data.country,
      countryCode: data.countryCode,
      city: data.city,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      source: 'GeoLite2',
    };
  }

  /**
   * Batch GeoIP lookup for multiple IPs
   */
  getGeoIpDataBatch(ips: string[]): Record<string, GeoIpData | null> {
    const results: Record<string, GeoIpData | null> = {};
    for (const ip of ips) {
      results[ip] = this.getGeoIpData(ip);
    }
    return results;
  }

  /**
   * Full enrichment for an IP (reputation + geo)
   */
  enrichIp(ip: string): {
    reputation: IpReputationData | null;
    geo: GeoIpData | null;
  } {
    return {
      reputation: this.checkIpReputation(ip),
      geo: this.getGeoIpData(ip),
    };
  }

  /**
   * Extract IP addresses from log message or metadata
   */
  extractIpAddresses(text: string): string[] {
    // Regex for IPv4 addresses
    const ipv4Regex =
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;

    const matches = text.match(ipv4Regex);
    if (!matches) return [];

    // Filter out private/local IPs and deduplicate
    return [...new Set(matches.filter((ip) => !this.isPrivateIp(ip)))];
  }

  /**
   * Check if an IP is private/local (not publicly routable)
   */
  private isPrivateIp(ip: string): boolean {
    const parts = ip.split('.').map(Number);

    // 10.0.0.0/8
    if (parts[0] === 10) return true;

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 127.0.0.0/8 (localhost)
    if (parts[0] === 127) return true;

    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;

    // 0.0.0.0
    if (parts.every((p) => p === 0)) return true;

    return false;
  }

  /**
   * Check if enrichment services are configured
   */
  isConfigured(): {
    ipReputation: boolean;
    geoIp: boolean;
  } {
    return {
      ipReputation: ipsumService.ready(),
      geoIp: geoLite2Service.isReady(),
    };
  }

  /**
   * Get detailed status of enrichment services
   */
  getStatus(): {
    ipReputation: {
      configured: boolean;
      ready: boolean;
      totalIps: number;
      lastUpdate: Date | null;
      source: string;
    };
    geoIp: {
      configured: boolean;
      ready: boolean;
      lastUpdate: Date | null;
      source: string;
    };
  } {
    const geoInfo = geoLite2Service.getInfo();
    const ipsumInfo = ipsumService.getInfo();

    return {
      ipReputation: {
        configured: true, // No API key needed
        ready: ipsumInfo.ready,
        totalIps: ipsumInfo.totalIps,
        lastUpdate: ipsumInfo.lastUpdate,
        source: 'IPsum (30+ threat intel feeds)',
      },
      geoIp: {
        configured: true, // No API key needed
        ready: geoInfo.ready,
        lastUpdate: geoInfo.lastUpdate,
        source: 'GeoLite2',
      },
    };
  }
}

// Singleton instance
export const enrichmentService = new EnrichmentService();
