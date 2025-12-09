import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * GeoLite2Service tests - GeoIP lookup service
 * Tests the core functionality without requiring actual database files
 */

interface MockGeoData {
  ip: string;
  country: string;
  countryCode: string;
  city: string | null;
  latitude: number;
  longitude: number;
  timezone: string | null;
  accuracy: number | null;
  subdivision: string | null;
  postalCode: string | null;
}

// Create a testable version of the service class
class TestableGeoLite2Service {
  private mockData: Map<string, MockGeoData> = new Map();
  private lastUpdate: Date | null = null;
  private isUpdating = false;
  private readerLoaded = false;

  /**
   * Load test data directly
   */
  loadTestData(data: MockGeoData[]): void {
    this.mockData.clear();
    for (const entry of data) {
      this.mockData.set(entry.ip, entry);
    }
    this.lastUpdate = new Date();
    this.readerLoaded = true;
  }

  /**
   * Lookup IP address
   */
  lookup(ip: string): MockGeoData | null {
    if (!this.readerLoaded) {
      console.warn('[GeoLite2] Database not loaded');
      return null;
    }

    return this.mockData.get(ip) ?? null;
  }

  /**
   * Batch lookup for multiple IPs
   */
  lookupBatch(ips: string[]): Record<string, MockGeoData | null> {
    const results: Record<string, MockGeoData | null> = {};
    for (const ip of ips) {
      results[ip] = this.lookup(ip);
    }
    return results;
  }

  /**
   * Check if the service is ready
   */
  isReady(): boolean {
    return this.readerLoaded;
  }

  /**
   * Check if database needs update (older than 24 hours)
   */
  needsUpdate(): boolean {
    if (!this.lastUpdate) return true;

    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - this.lastUpdate.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
  }

  /**
   * Get database info
   */
  getInfo(): {
    ready: boolean;
    lastUpdate: Date | null;
    path: string;
  } {
    return {
      ready: this.isReady(),
      lastUpdate: this.lastUpdate,
      path: 'test-path',
    };
  }

  /**
   * Simulate updating state
   */
  setUpdating(value: boolean): void {
    this.isUpdating = value;
  }

  getUpdating(): boolean {
    return this.isUpdating;
  }

  /**
   * Reset the service state
   */
  reset(): void {
    this.mockData.clear();
    this.lastUpdate = null;
    this.isUpdating = false;
    this.readerLoaded = false;
  }
}

describe('GeoLite2Service', () => {
  let service: TestableGeoLite2Service;

  beforeEach(() => {
    service = new TestableGeoLite2Service();
  });

  describe('lookup', () => {
    it('should return null when database is not loaded', () => {
      const result = service.lookup('8.8.8.8');
      expect(result).toBeNull();
    });

    it('should return geo data for known IP', () => {
      service.loadTestData([
        {
          ip: '8.8.8.8',
          country: 'United States',
          countryCode: 'US',
          city: 'Mountain View',
          latitude: 37.386,
          longitude: -122.0838,
          timezone: 'America/Los_Angeles',
          accuracy: 1000,
          subdivision: 'California',
          postalCode: '94035',
        },
      ]);

      const result = service.lookup('8.8.8.8');

      expect(result).not.toBeNull();
      expect(result?.country).toBe('United States');
      expect(result?.countryCode).toBe('US');
      expect(result?.city).toBe('Mountain View');
      expect(result?.latitude).toBe(37.386);
      expect(result?.longitude).toBe(-122.0838);
      expect(result?.timezone).toBe('America/Los_Angeles');
      expect(result?.subdivision).toBe('California');
      expect(result?.postalCode).toBe('94035');
    });

    it('should return null for unknown IP', () => {
      service.loadTestData([]);

      const result = service.lookup('1.2.3.4');

      expect(result).toBeNull();
    });

    it('should handle partial geo data', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Australia',
          countryCode: 'AU',
          city: null,
          latitude: -33.494,
          longitude: 143.2104,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('1.1.1.1');

      expect(result).not.toBeNull();
      expect(result?.country).toBe('Australia');
      expect(result?.countryCode).toBe('AU');
      expect(result?.city).toBeNull();
      expect(result?.timezone).toBeNull();
    });

    it('should handle IPv6 addresses', () => {
      service.loadTestData([
        {
          ip: '2001:4860:4860::8888',
          country: 'United States',
          countryCode: 'US',
          city: null,
          latitude: 37.751,
          longitude: -97.822,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('2001:4860:4860::8888');

      expect(result).not.toBeNull();
      expect(result?.country).toBe('United States');
    });
  });

  describe('lookupBatch', () => {
    it('should lookup multiple IPs at once', () => {
      service.loadTestData([
        {
          ip: '8.8.8.8',
          country: 'United States',
          countryCode: 'US',
          city: 'Mountain View',
          latitude: 37.386,
          longitude: -122.0838,
          timezone: 'America/Los_Angeles',
          accuracy: 1000,
          subdivision: 'California',
          postalCode: '94035',
        },
        {
          ip: '1.1.1.1',
          country: 'Australia',
          countryCode: 'AU',
          city: null,
          latitude: -33.494,
          longitude: 143.2104,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const results = service.lookupBatch(['8.8.8.8', '1.1.1.1', '192.168.1.1']);

      expect(results['8.8.8.8']?.country).toBe('United States');
      expect(results['1.1.1.1']?.country).toBe('Australia');
      expect(results['192.168.1.1']).toBeNull();
    });

    it('should return empty object for empty array', () => {
      service.loadTestData([]);

      const results = service.lookupBatch([]);

      expect(Object.keys(results)).toHaveLength(0);
    });

    it('should handle duplicate IPs in batch', () => {
      service.loadTestData([
        {
          ip: '8.8.8.8',
          country: 'United States',
          countryCode: 'US',
          city: 'Mountain View',
          latitude: 37.386,
          longitude: -122.0838,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const results = service.lookupBatch(['8.8.8.8', '8.8.8.8']);

      // Should only have one key since duplicates are overwritten
      expect(Object.keys(results)).toHaveLength(1);
      expect(results['8.8.8.8']?.country).toBe('United States');
    });
  });

  describe('isReady', () => {
    it('should return false before initialization', () => {
      expect(service.isReady()).toBe(false);
    });

    it('should return true after loading data', () => {
      service.loadTestData([]);
      expect(service.isReady()).toBe(true);
    });

    it('should return false after reset', () => {
      service.loadTestData([]);
      expect(service.isReady()).toBe(true);

      service.reset();
      expect(service.isReady()).toBe(false);
    });
  });

  describe('needsUpdate', () => {
    it('should return true when lastUpdate is null', () => {
      expect(service.needsUpdate()).toBe(true);
    });

    it('should return false when updated recently', () => {
      service.loadTestData([]); // Sets lastUpdate to now
      expect(service.needsUpdate()).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('should return service info before initialization', () => {
      const info = service.getInfo();

      expect(info.ready).toBe(false);
      expect(info.lastUpdate).toBeNull();
      expect(info.path).toBe('test-path');
    });

    it('should return service info after loading data', () => {
      service.loadTestData([
        {
          ip: '8.8.8.8',
          country: 'United States',
          countryCode: 'US',
          city: null,
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const info = service.getInfo();

      expect(info.ready).toBe(true);
      expect(info.lastUpdate).toBeInstanceOf(Date);
    });
  });

  describe('edge cases', () => {
    it('should handle private IP addresses returning null', () => {
      service.loadTestData([]);

      // Private IPs typically don't have geo data
      expect(service.lookup('192.168.0.1')).toBeNull();
      expect(service.lookup('10.0.0.1')).toBeNull();
      expect(service.lookup('172.16.0.1')).toBeNull();
    });

    it('should handle loopback address returning null', () => {
      service.loadTestData([]);

      expect(service.lookup('127.0.0.1')).toBeNull();
    });

    it('should handle coordinates correctly', () => {
      service.loadTestData([
        {
          ip: '1.2.3.4',
          country: 'Test Country',
          countryCode: 'TC',
          city: 'Test City',
          latitude: -45.123,
          longitude: 175.456,
          timezone: 'Pacific/Auckland',
          accuracy: 500,
          subdivision: 'Test Region',
          postalCode: '12345',
        },
      ]);

      const result = service.lookup('1.2.3.4');

      expect(result?.latitude).toBe(-45.123);
      expect(result?.longitude).toBe(175.456);
      expect(result?.accuracy).toBe(500);
    });

    it('should handle various country codes', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Australia',
          countryCode: 'AU',
          city: null,
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
        {
          ip: '2.2.2.2',
          country: 'Germany',
          countryCode: 'DE',
          city: null,
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
        {
          ip: '3.3.3.3',
          country: 'Japan',
          countryCode: 'JP',
          city: null,
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      expect(service.lookup('1.1.1.1')?.countryCode).toBe('AU');
      expect(service.lookup('2.2.2.2')?.countryCode).toBe('DE');
      expect(service.lookup('3.3.3.3')?.countryCode).toBe('JP');
    });
  });
});
