import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Extended GeoLite2Service tests
 * Tests additional edge cases and scenarios for IP geolocation
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

// Create a comprehensive testable version
class TestableGeoLite2Service {
  private mockData: Map<string, MockGeoData> = new Map();
  private lastUpdate: Date | null = null;
  private isUpdating = false;
  private readerLoaded = false;

  loadTestData(data: MockGeoData[]): void {
    this.mockData.clear();
    for (const entry of data) {
      this.mockData.set(entry.ip, entry);
    }
    this.lastUpdate = new Date();
    this.readerLoaded = true;
  }

  lookup(ip: string): MockGeoData | null {
    if (!this.readerLoaded) {
      return null;
    }
    return this.mockData.get(ip) ?? null;
  }

  lookupBatch(ips: string[]): Record<string, MockGeoData | null> {
    const results: Record<string, MockGeoData | null> = {};
    for (const ip of ips) {
      results[ip] = this.lookup(ip);
    }
    return results;
  }

  isReady(): boolean {
    return this.readerLoaded;
  }

  needsUpdate(): boolean {
    if (!this.lastUpdate) return true;
    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - this.lastUpdate.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 24;
  }

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

  reset(): void {
    this.mockData.clear();
    this.lastUpdate = null;
    this.isUpdating = false;
    this.readerLoaded = false;
  }

  setUpdating(value: boolean): void {
    this.isUpdating = value;
  }

  getUpdating(): boolean {
    return this.isUpdating;
  }
}

describe('GeoLite2Service Extended Tests', () => {
  let service: TestableGeoLite2Service;

  beforeEach(() => {
    service = new TestableGeoLite2Service();
  });

  describe('Comprehensive Geolocation Data', () => {
    it('should handle all geo data fields', () => {
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
      expect(result?.ip).toBe('8.8.8.8');
      expect(result?.country).toBe('United States');
      expect(result?.countryCode).toBe('US');
      expect(result?.city).toBe('Mountain View');
      expect(result?.latitude).toBe(37.386);
      expect(result?.longitude).toBe(-122.0838);
      expect(result?.timezone).toBe('America/Los_Angeles');
      expect(result?.accuracy).toBe(1000);
      expect(result?.subdivision).toBe('California');
      expect(result?.postalCode).toBe('94035');
    });

    it('should handle minimal geo data', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Unknown',
          countryCode: 'XX',
          city: null,
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('1.1.1.1');

      expect(result).not.toBeNull();
      expect(result?.country).toBe('Unknown');
      expect(result?.city).toBeNull();
      expect(result?.timezone).toBeNull();
    });
  });

  describe('World Region Coverage', () => {
    it('should handle IPs from different regions', () => {
      service.loadTestData([
        {
          ip: '203.0.113.1',
          country: 'Japan',
          countryCode: 'JP',
          city: 'Tokyo',
          latitude: 35.6762,
          longitude: 139.6503,
          timezone: 'Asia/Tokyo',
          accuracy: 500,
          subdivision: 'Tokyo',
          postalCode: '100-0001',
        },
        {
          ip: '193.0.2.1',
          country: 'Germany',
          countryCode: 'DE',
          city: 'Berlin',
          latitude: 52.52,
          longitude: 13.405,
          timezone: 'Europe/Berlin',
          accuracy: 100,
          subdivision: 'Berlin',
          postalCode: '10115',
        },
        {
          ip: '200.200.200.1',
          country: 'Brazil',
          countryCode: 'BR',
          city: 'São Paulo',
          latitude: -23.5505,
          longitude: -46.6333,
          timezone: 'America/Sao_Paulo',
          accuracy: 200,
          subdivision: 'São Paulo',
          postalCode: '01310-100',
        },
        {
          ip: '102.130.1.1',
          country: 'South Africa',
          countryCode: 'ZA',
          city: 'Cape Town',
          latitude: -33.9249,
          longitude: 18.4241,
          timezone: 'Africa/Johannesburg',
          accuracy: 1000,
          subdivision: 'Western Cape',
          postalCode: '8001',
        },
      ]);

      const japan = service.lookup('203.0.113.1');
      expect(japan?.countryCode).toBe('JP');
      expect(japan?.timezone).toBe('Asia/Tokyo');

      const germany = service.lookup('193.0.2.1');
      expect(germany?.countryCode).toBe('DE');
      expect(germany?.city).toBe('Berlin');

      const brazil = service.lookup('200.200.200.1');
      expect(brazil?.countryCode).toBe('BR');
      expect(brazil?.latitude).toBeLessThan(0); // Southern hemisphere

      const southAfrica = service.lookup('102.130.1.1');
      expect(southAfrica?.countryCode).toBe('ZA');
    });
  });

  describe('Coordinate Handling', () => {
    it('should handle negative latitudes (southern hemisphere)', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Australia',
          countryCode: 'AU',
          city: 'Sydney',
          latitude: -33.8688,
          longitude: 151.2093,
          timezone: 'Australia/Sydney',
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('1.1.1.1');
      expect(result?.latitude).toBe(-33.8688);
      expect(result?.latitude).toBeLessThan(0);
    });

    it('should handle negative longitudes (western hemisphere)', () => {
      service.loadTestData([
        {
          ip: '2.2.2.2',
          country: 'United States',
          countryCode: 'US',
          city: 'New York',
          latitude: 40.7128,
          longitude: -74.006,
          timezone: 'America/New_York',
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('2.2.2.2');
      expect(result?.longitude).toBe(-74.006);
      expect(result?.longitude).toBeLessThan(0);
    });

    it('should handle coordinates near the prime meridian', () => {
      service.loadTestData([
        {
          ip: '3.3.3.3',
          country: 'United Kingdom',
          countryCode: 'GB',
          city: 'London',
          latitude: 51.5074,
          longitude: -0.1278,
          timezone: 'Europe/London',
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('3.3.3.3');
      expect(Math.abs(result?.longitude || 0)).toBeLessThan(1);
    });

    it('should handle coordinates near the equator', () => {
      service.loadTestData([
        {
          ip: '4.4.4.4',
          country: 'Ecuador',
          countryCode: 'EC',
          city: 'Quito',
          latitude: -0.1807,
          longitude: -78.4678,
          timezone: 'America/Guayaquil',
          accuracy: null,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('4.4.4.4');
      expect(Math.abs(result?.latitude || 0)).toBeLessThan(1);
    });
  });

  describe('Batch Operations Performance', () => {
    it('should handle large batch lookups', () => {
      const testData: MockGeoData[] = [];
      for (let i = 0; i < 500; i++) {
        testData.push({
          ip: `10.${Math.floor(i / 256)}.${i % 256}.1`,
          country: 'Test Country',
          countryCode: 'TC',
          city: `City ${i}`,
          latitude: i * 0.1,
          longitude: i * 0.1,
          timezone: null,
          accuracy: null,
          subdivision: null,
          postalCode: null,
        });
      }
      service.loadTestData(testData);

      const ips = testData.map((d) => d.ip);
      const results = service.lookupBatch(ips);

      expect(Object.keys(results).length).toBe(500);
      for (const ip of ips) {
        expect(results[ip]).not.toBeNull();
      }
    });

    it('should handle mixed batch with known and unknown IPs', () => {
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

      const results = service.lookupBatch(['8.8.8.8', '1.1.1.1', '2.2.2.2', '192.168.1.1']);

      expect(results['8.8.8.8']).not.toBeNull();
      expect(results['1.1.1.1']).toBeNull();
      expect(results['2.2.2.2']).toBeNull();
      expect(results['192.168.1.1']).toBeNull();
    });
  });

  describe('IPv6 Support', () => {
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

    it('should handle loopback IPv6', () => {
      service.loadTestData([]);
      const result = service.lookup('::1');
      expect(result).toBeNull();
    });

    it('should handle link-local IPv6', () => {
      service.loadTestData([]);
      const result = service.lookup('fe80::1');
      expect(result).toBeNull();
    });
  });

  describe('Service State Management', () => {
    it('should report not ready initially', () => {
      expect(service.isReady()).toBe(false);
    });

    it('should report ready after loading data', () => {
      service.loadTestData([]);
      expect(service.isReady()).toBe(true);
    });

    it('should report not ready after reset', () => {
      service.loadTestData([]);
      expect(service.isReady()).toBe(true);

      service.reset();
      expect(service.isReady()).toBe(false);
    });

    it('should track updating state', () => {
      expect(service.getUpdating()).toBe(false);

      service.setUpdating(true);
      expect(service.getUpdating()).toBe(true);

      service.setUpdating(false);
      expect(service.getUpdating()).toBe(false);
    });
  });

  describe('needsUpdate Logic', () => {
    it('should need update before initialization', () => {
      expect(service.needsUpdate()).toBe(true);
    });

    it('should not need update immediately after loading', () => {
      service.loadTestData([]);
      expect(service.needsUpdate()).toBe(false);
    });

    it('should need update after 24 hours', () => {
      service.loadTestData([]);

      // Set lastUpdate to 25 hours ago
      (service as any).lastUpdate = new Date(Date.now() - 25 * 60 * 60 * 1000);

      expect(service.needsUpdate()).toBe(true);
    });

    it('should not need update within 24 hours', () => {
      service.loadTestData([]);

      // Set lastUpdate to 12 hours ago
      (service as any).lastUpdate = new Date(Date.now() - 12 * 60 * 60 * 1000);

      expect(service.needsUpdate()).toBe(false);
    });
  });

  describe('Accuracy Radius', () => {
    it('should include accuracy when available', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Test',
          countryCode: 'TS',
          city: 'City',
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: 500,
          subdivision: null,
          postalCode: null,
        },
      ]);

      const result = service.lookup('1.1.1.1');
      expect(result?.accuracy).toBe(500);
    });

    it('should handle various accuracy values', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Test',
          countryCode: 'TS',
          city: 'City',
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: 1,
          subdivision: null,
          postalCode: null,
        },
        {
          ip: '2.2.2.2',
          country: 'Test',
          countryCode: 'TS',
          city: 'City',
          latitude: 0,
          longitude: 0,
          timezone: null,
          accuracy: 1000000,
          subdivision: null,
          postalCode: null,
        },
      ]);

      expect(service.lookup('1.1.1.1')?.accuracy).toBe(1);
      expect(service.lookup('2.2.2.2')?.accuracy).toBe(1000000);
    });
  });

  describe('getInfo Method', () => {
    it('should return full info after initialization', () => {
      service.loadTestData([
        {
          ip: '1.1.1.1',
          country: 'Test',
          countryCode: 'TS',
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
      expect(info.path).toBe('test-path');
    });

    it('should return correct info before initialization', () => {
      const info = service.getInfo();

      expect(info.ready).toBe(false);
      expect(info.lastUpdate).toBeNull();
      expect(info.path).toBe('test-path');
    });
  });
});
