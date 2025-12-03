import type { IpReputationData, GeoIpData } from './types';

export class EnrichmentService {
  private abuseIpDbApiKey: string | null;
  private maxMindLicenseKey: string | null;

  constructor() {
    this.abuseIpDbApiKey = process.env.ABUSEIPDB_API_KEY ?? null;
    this.maxMindLicenseKey = process.env.MAXMIND_LICENSE_KEY ?? null;
  }

  /**
   * Check IP reputation using AbuseIPDB API
   * https://www.abuseipdb.com/api
   */
  async checkIpReputation(ip: string): Promise<IpReputationData | null> {
    if (!this.abuseIpDbApiKey) {
      console.warn(
        'AbuseIPDB API key not configured. Skipping IP reputation check.'
      );
      return null;
    }

    try {
      const response = await fetch(
        `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90&verbose`,
        {
          method: 'GET',
          headers: {
            Key: this.abuseIpDbApiKey,
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error(
          `AbuseIPDB API error: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const data = await response.json();
      const ipData = data.data;

      // Determine reputation based on abuse confidence score
      let reputation: 'clean' | 'suspicious' | 'malicious' = 'clean';
      if (ipData.abuseConfidenceScore >= 75) {
        reputation = 'malicious';
      } else if (ipData.abuseConfidenceScore >= 25) {
        reputation = 'suspicious';
      }

      return {
        ip,
        reputation,
        abuseConfidenceScore: ipData.abuseConfidenceScore,
        country: ipData.countryCode,
        isp: ipData.isp,
        domain: ipData.domain,
        usageType: ipData.usageType,
        source: 'AbuseIPDB',
        lastChecked: new Date(),
      };
    } catch (error) {
      console.error('Error checking IP reputation:', error);
      return null;
    }
  }

  /**
   * Batch check multiple IPs (max 100 per request)
   */
  async checkIpReputationBatch(
    ips: string[]
  ): Promise<Record<string, IpReputationData | null>> {
    const results: Record<string, IpReputationData | null> = {};

    // Process in batches of 10 to avoid rate limits
    for (let i = 0; i < ips.length; i += 10) {
      const batch = ips.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map((ip) => this.checkIpReputation(ip))
      );

      batch.forEach((ip, index) => {
        results[ip] = batchResults[index];
      });
    }

    return results;
  }

  /**
   * Get geographic information for an IP using MaxMind GeoIP2 API
   * https://dev.maxmind.com/geoip/docs/web-services
   */
  async getGeoIpData(ip: string): Promise<GeoIpData | null> {
    if (!this.maxMindLicenseKey) {
      console.warn(
        'MaxMind license key not configured. Skipping GeoIP lookup.'
      );
      return null;
    }

    try {

      const accountId = process.env.MAXMIND_ACCOUNT_ID ?? '';
      const auth = Buffer.from(
        `${accountId}:${this.maxMindLicenseKey}`
      ).toString('base64');

      const response = await fetch(
        `https://geoip.maxmind.com/geoip/v2.1/city/${encodeURIComponent(ip)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error(
          `MaxMind API error: ${response.status} ${response.statusText}`
        );
        return null;
      }

      const data = await response.json();

      return {
        ip,
        country: data.country?.names?.en ?? 'Unknown',
        countryCode: data.country?.iso_code ?? 'XX',
        city: data.city?.names?.en ?? null,
        latitude: data.location?.latitude ?? 0,
        longitude: data.location?.longitude ?? 0,
        timezone: data.location?.time_zone ?? null,
        source: 'MaxMind',
      };
    } catch (error) {
      console.error('Error getting GeoIP data:', error);
      return null;
    }
  }

  /**
   * Batch GeoIP lookup for multiple IPs
   */
  async getGeoIpDataBatch(
    ips: string[]
  ): Promise<Record<string, GeoIpData | null>> {
    const results: Record<string, GeoIpData | null> = {};

    // Process in batches of 10 to avoid rate limits
    for (let i = 0; i < ips.length; i += 10) {
      const batch = ips.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map((ip) => this.getGeoIpData(ip))
      );

      batch.forEach((ip, index) => {
        results[ip] = batchResults[index];
      });
    }

    return results;
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

    // Filter out private/local IPs
    return matches.filter((ip) => !this.isPrivateIp(ip));
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
      ipReputation: this.abuseIpDbApiKey !== null,
      geoIp: this.maxMindLicenseKey !== null,
    };
  }
}
